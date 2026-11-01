-- Security hardening from the pre-release audit. Forward-only.
--
-- If this fails with a foreign key violation, a row already points at another
-- user's Google account or calendar. Nothing should legitimately do that, so
-- review those rows rather than loosening the constraint.

-- Cross-user references. RLS checked user_id, and a plain foreign key only
-- checked that the target existed, so any user could attach their own rows to
-- someone else's Google account. These keys tie each row to a target with the
-- same owner.
alter table public.google_accounts
  add constraint google_accounts_id_user_id_key unique (id, user_id);
alter table public.calendars
  add constraint calendars_id_user_id_key unique (id, user_id);

alter table public.calendars
  drop constraint calendars_google_account_id_fkey,
  add constraint calendars_google_account_owner_fkey
    foreign key (google_account_id, user_id)
    references public.google_accounts (id, user_id) on delete cascade;

alter table public.booking_links
  drop constraint booking_links_google_account_id_fkey,
  add constraint booking_links_google_account_owner_fkey
    foreign key (google_account_id, user_id)
    references public.google_accounts (id, user_id) on delete set null (google_account_id);

alter table public.events
  drop constraint events_calendar_id_fkey,
  add constraint events_calendar_owner_fkey
    foreign key (calendar_id, user_id)
    references public.calendars (id, user_id) on delete cascade;

alter table public.tasks
  drop constraint tasks_calendar_id_fkey,
  add constraint tasks_calendar_owner_fkey
    foreign key (calendar_id, user_id)
    references public.calendars (id, user_id) on delete set null (calendar_id);

alter table public.routines
  drop constraint routines_calendar_id_fkey,
  add constraint routines_calendar_owner_fkey
    foreign key (calendar_id, user_id)
    references public.calendars (id, user_id) on delete set null (calendar_id);

-- A task can only carry the owner's own tags.
drop policy "Users manage task tags via task ownership" on public.task_tags;
create policy "Users manage task tags via task ownership" on public.task_tags
  for all
  using (
    exists (select 1 from public.tasks where tasks.id = task_tags.task_id and tasks.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.tasks where tasks.id = task_tags.task_id and tasks.user_id = auth.uid())
    and exists (select 1 from public.tags where tags.id = task_tags.tag_id and tags.user_id = auth.uid())
  );

-- Public booking goes through the API routes, which enforce availability, rate
-- limits and approval. Direct access with the public key skipped all of them and
-- exposed user_id and google_account_id on every public link.
drop policy "Public can create bookings" on public.bookings;
drop policy "Public can read public booking links" on public.booking_links;

-- Lookups go by slug alone, so a slug has to identify one link.
alter table public.booking_links drop constraint booking_links_user_id_slug_key;
alter table public.booking_links add constraint booking_links_slug_key unique (slug);

-- Notifications use private Realtime channels. Each user can read only their
-- own, and no policy allows clients to send. The server broadcasts with the
-- service role.
create policy "Users read own notification channel" on realtime.messages
  for select to authenticated
  using (realtime.topic() = 'notifications:' || auth.uid()::text);

-- The public key needs no table or function access now that the policies above
-- are gone. A future table without RLS is no longer world-writable by default.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon, public;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon, public;

grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.rate_limit_check(text, int, timestamptz, timestamptz) from authenticated;

-- Definer function: pin the search path.
alter function public.handle_new_user() set search_path = public;
