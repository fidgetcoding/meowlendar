-- Local calendars: events with no Google account behind them. Every user gets one
-- on sign-up, so the app works before, or without ever, connecting Google.

alter table public.calendars
  alter column google_account_id drop not null,
  alter column google_calendar_id drop not null,
  add column source text not null default 'google'
    check (source in ('google', 'local')),
  add constraint calendars_source_shape check (
    (source = 'local' and google_account_id is null and google_calendar_id is null)
    or (source = 'google' and google_account_id is not null and google_calendar_id is not null)
  );

-- Occurrences removed from a recurring series.
alter table public.events
  add column recurrence_exceptions timestamptz[] not null default '{}';

-- Nothing to sync on a local calendar, whatever the client sends. The UI marks
-- every edit pending_push without knowing where the calendar lives.
create function public.events_local_calendar_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from public.calendars c where c.id = new.calendar_id and c.source = 'local') then
    new.sync_status := 'synced';
    new.google_event_id := null;
    new.etag := null;
  end if;
  return new;
end;
$$;

create trigger events_local_calendar_guard
  before insert or update of calendar_id, sync_status, google_event_id on public.events
  for each row execute function public.events_local_calendar_guard();

insert into public.calendars (user_id, name, color, source, is_primary)
select p.id, 'My Calendar', '#f9a825', 'local', false
from public.profiles p
where not exists (
  select 1 from public.calendars c where c.user_id = p.id and c.source = 'local'
);

-- New users get a local calendar. Usernames also become unique here: two people
-- named nate@ on different domains made the second sign-up fail outright, because
-- the username came from the email with no check for a collision.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_name text;
  final_name text;
begin
  base_name := coalesce(
    nullif(lower(regexp_replace(coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)), '[^a-zA-Z0-9]', '', 'g')), ''),
    'user'
  );
  final_name := left(base_name, 50);
  if exists (select 1 from public.profiles where username = final_name) then
    final_name := left(base_name, 50) || substr(new.id::text, 1, 8);
  end if;

  insert into public.profiles (id, email, username, display_name, settings)
  values (
    new.id,
    new.email,
    final_name,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    '{"timezone": "America/New_York", "time_format": "12h", "date_format": "MM/DD/YYYY", "first_day_of_week": "sunday", "initial_view": "week", "default_task_duration": 30, "theme_accent_color": "#6366f1", "time_drag_resolution": 15, "show_weekends": true, "show_declined_events": false, "show_completed_tasks": true, "dim_past_events": true, "undo_grace_period": 30, "background_density": "comfortable", "move_due_date_behavior": "ask", "language": "en", "time_grid_start": "06:00", "time_grid_end": "22:00", "time_display_resolution": 15, "limit_events_per_day": 4}'::jsonb
  );

  insert into public.calendars (user_id, name, color, source, is_primary)
  values (new.id, 'My Calendar', '#f9a825', 'local', false);

  return new;
end;
$$;
