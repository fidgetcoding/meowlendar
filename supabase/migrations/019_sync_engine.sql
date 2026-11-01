-- What automatic sync needs.

-- Google sync tokens belong to one calendar. The code kept a single token per
-- account, so every calendar but the last got a token Google rejects. It now uses
-- these columns, which have been here unused since the first migration.
alter table public.calendars
  add column if not exists sync_token text,
  add column if not exists last_synced_at timestamptz;

-- Stopping a watch channel needs the id Google gave the resource.
alter table public.google_accounts
  add column webhook_resource_id text;

-- Keeps two app instances from running the same background job at once.
create table public.scheduler_leases (
  name text primary key,
  held_until timestamptz not null
);
alter table public.scheduler_leases enable row level security;
revoke all on public.scheduler_leases from anon, authenticated;

create function public.try_scheduler_lease(p_name text, p_seconds int)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  taken int;
begin
  insert into public.scheduler_leases (name, held_until)
  values (p_name, now() + make_interval(secs => p_seconds))
  on conflict (name) do update
    set held_until = excluded.held_until
    where public.scheduler_leases.held_until < now();
  get diagnostics taken = row_count;
  return taken = 1;
end;
$$;
revoke all on function public.try_scheduler_lease(text, int) from public, anon, authenticated;
grant execute on function public.try_scheduler_lease(text, int) to service_role;

-- The app deletes events straight from the browser, which never reached Google, so
-- the event stayed on the user's Google calendar. Each delete now leaves a note for
-- the sync job. Deletes cascading from a disconnected account or removed calendar
-- leave none: disconnecting must not empty anyone's Google calendar.
create table public.google_event_tombstones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  google_account_id uuid not null references public.google_accounts(id) on delete cascade,
  google_calendar_id text not null,
  google_event_id text not null,
  created_at timestamptz not null default now()
);
create index idx_google_event_tombstones_user on public.google_event_tombstones (user_id);
alter table public.google_event_tombstones enable row level security;
revoke all on public.google_event_tombstones from anon, authenticated;

create function public.record_google_event_tombstone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Depth 1 is a direct delete. A cascade runs deeper.
  if old.google_event_id is not null and pg_trigger_depth() = 1 then
    insert into public.google_event_tombstones (user_id, google_account_id, google_calendar_id, google_event_id)
    select old.user_id, c.google_account_id, c.google_calendar_id, old.google_event_id
    from public.calendars c
    where c.id = old.calendar_id and c.source = 'google';
  end if;
  return old;
end;
$$;

create trigger record_google_event_tombstone
  before delete on public.events
  for each row execute function public.record_google_event_tombstone();
