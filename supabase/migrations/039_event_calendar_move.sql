-- Moving an event retains cleanup of the old target, including a late push.
create function public.event_calendar_move()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.calendar_id is distinct from new.calendar_id then
    if old.google_event_id is not null then
      insert into public.google_event_tombstones(user_id, google_account_id, google_calendar_id, google_event_id)
        select old.user_id, c.google_account_id, c.google_calendar_id, old.google_event_id
        from public.calendars c where c.id = old.calendar_id and c.user_id = old.user_id and c.source = 'google';
    end if;
    new.google_event_id := null;
    new.etag := null;
    new.sync_status := 'pending_push';
    new.retry_count := 0;
    new.next_retry_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.event_calendar_move() from public, anon, authenticated;
create trigger event_calendar_move before update of calendar_id on public.events
  for each row execute function public.event_calendar_move();
create or replace function public.finish_event_push(p_event jsonb, p_google jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare row public.events; snapshot public.events;
begin
  snapshot := jsonb_populate_record(null::public.events, p_event);
  select * into row from public.events where id = snapshot.id for update;
  if not found or row.calendar_id is distinct from snapshot.calendar_id then
    insert into public.google_event_tombstones(user_id, google_account_id, google_calendar_id, google_event_id)
      select c.user_id, c.google_account_id, c.google_calendar_id, p_google->>'id'
      from public.calendars c where c.id = snapshot.calendar_id and c.user_id = snapshot.user_id and c.source = 'google';
    if row.id is null then return null; end if;
  end if;
  if row.updated_at = snapshot.updated_at and row.calendar_id = snapshot.calendar_id then
    update public.events set etag = p_google->>'etag', sync_status = 'synced',
      google_event_id = p_google->>'id', retry_count = 0, next_retry_at = null,
      conferencing_url = coalesce(p_google->>'conferencing_url', conferencing_url)
      where id = row.id returning * into row;
  else
    -- An older push may have reached Google last. Retry the current local row.
    update public.events set sync_status = 'pending_push', retry_count = 0, next_retry_at = null
      where id = row.id returning * into row;
  end if;
  return to_jsonb(row);
end;
$$;
