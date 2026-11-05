-- One row per Google event per calendar, and the iCalUID that ties together the
-- copies of one meeting seen through different accounts and calendars. The grid
-- shows each meeting once by that id.

alter table public.events add column if not exists ical_uid text;

-- Earlier syncs could race into two rows for one Google event. Keep the row with an
-- edit still waiting to go out, else the newest, and park the rest here rather than
-- throw them away. Service role only.
create table if not exists public.events_duplicate_archive (
  id uuid primary key,
  kept_id uuid not null,
  row jsonb not null,
  archived_at timestamptz not null default now()
);
alter table public.events_duplicate_archive enable row level security;
revoke all on public.events_duplicate_archive from anon, authenticated;

with ranked as (
  select id,
    first_value(id) over w as kept_id,
    row_number() over w as rank
  from public.events
  where google_event_id is not null
  window w as (
    partition by calendar_id, google_event_id
    order by (sync_status = 'pending_push') desc, updated_at desc, created_at desc, id
  )
), archived as (
  insert into public.events_duplicate_archive (id, kept_id, row)
  select e.id, r.kept_id, to_jsonb(e)
  from public.events e join ranked r on r.id = e.id
  where r.rank > 1
  on conflict (id) do nothing
  returning id
)
delete from public.events where id in (select id from archived);

create unique index if not exists events_calendar_google_event_key
  on public.events (calendar_id, google_event_id)
  where google_event_id is not null;

-- The index now does the serializing. Also carries the iCalUID and colour, which the
-- first insert used to drop.
create or replace function public.insert_google_event_once(p_event jsonb)
returns text language plpgsql security invoker set search_path = public as $$
declare row public.events;
begin
  row := jsonb_populate_record(null::public.events, p_event);
  insert into public.events(user_id, calendar_id, google_event_id, ical_uid, title, notes, start_time, end_time,
    timezone, is_all_day, location, color_override, visibility, privacy, conferencing_url, recurrence_rule,
    recurrence_id, recurrence_exceptions, attendees, reminders, status, sync_status, etag)
  values(row.user_id, row.calendar_id, row.google_event_id, row.ical_uid, row.title, row.notes, row.start_time,
    row.end_time, row.timezone, row.is_all_day, row.location, row.color_override, row.visibility, row.privacy,
    row.conferencing_url, row.recurrence_rule, row.recurrence_id, coalesce(row.recurrence_exceptions, '{}'),
    row.attendees, row.reminders, row.status, 'synced', row.etag)
  on conflict (calendar_id, google_event_id) where google_event_id is not null do nothing;
  if found then return 'created'; end if;
  return 'updated';
end;
$$;

-- Rows synced before this have no iCalUID. A fresh full pull of each Google calendar
-- fills it in, the same pull a first connect or an expired sync token runs.
update public.calendars set sync_token = null where source = 'google' and sync_token is not null;
