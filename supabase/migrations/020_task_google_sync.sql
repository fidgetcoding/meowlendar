-- Scheduled tasks can appear on a Google calendar the user picks. A task stays a
-- task: its Google event carries the task id in a private property, so incoming sync
-- updates the task instead of creating an event row next to it.

alter table public.tasks
  add column google_event_id text,
  add column google_calendar_id uuid,
  add column google_etag text,
  add column google_dirty boolean not null default false,
  add column google_retry_count int not null default 0,
  add column google_next_retry_at timestamptz,
  add constraint tasks_google_calendar_owner_fkey
    foreign key (google_calendar_id, user_id)
    references public.calendars (id, user_id) on delete set null (google_calendar_id);

create unique index tasks_google_event_unique
  on public.tasks (google_calendar_id, google_event_id)
  where google_event_id is not null;

create index tasks_google_dirty on public.tasks (user_id) where google_dirty;

-- Marks tasks that changed, whatever path changed them: the browser writes straight
-- to the database. A write that changes the etag or link came from the sync itself,
-- and marking it would push every sync straight back to Google in a loop.
create function public.tasks_mark_google_dirty()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.google_dirty := new.scheduled_start is not null;
    return new;
  end if;

  if new.google_etag is distinct from old.google_etag
     or new.google_event_id is distinct from old.google_event_id then
    return new;
  end if;

  if new.title is distinct from old.title
     or new.notes is distinct from old.notes
     or new.location is distinct from old.location
     or new.status is distinct from old.status
     or new.visibility is distinct from old.visibility
     or new.privacy is distinct from old.privacy
     or new.scheduled_start is distinct from old.scheduled_start
     or new.scheduled_end is distinct from old.scheduled_end then
    new.google_dirty := true;
    new.google_retry_count := 0;
    new.google_next_retry_at := null;
  end if;
  return new;
end;
$$;

create trigger tasks_mark_google_dirty
  before insert or update on public.tasks
  for each row execute function public.tasks_mark_google_dirty();

-- A deleted task leaves a note so its Google event goes too.
create function public.record_task_google_tombstone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.google_event_id is not null and pg_trigger_depth() = 1 then
    insert into public.google_event_tombstones (user_id, google_account_id, google_calendar_id, google_event_id)
    select old.user_id, c.google_account_id, c.google_calendar_id, old.google_event_id
    from public.calendars c
    where c.id = old.google_calendar_id and c.source = 'google';
  end if;
  return old;
end;
$$;

create trigger record_task_google_tombstone
  before delete on public.tasks
  for each row execute function public.record_task_google_tombstone();
