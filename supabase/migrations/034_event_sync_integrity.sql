-- Service-only sync transitions use row locks so a network response cannot mark
-- a newer local edit clean. No user-facing field is copied from a stale response.
create function public.prepare_event_push(p_id uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare row public.events;
begin
  select * into row from public.events where id = p_id for update;
  if not found then return null; end if;
  if row.google_event_id is null then
    update public.events set google_event_id = 'me' || replace(id::text, '-', ''), sync_status = 'pending_push'
      where id = p_id returning * into row;
  end if;
  return to_jsonb(row);
end;
$$;
create function public.finish_event_push(p_event jsonb, p_google jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare row public.events; snapshot public.events;
begin
  snapshot := jsonb_populate_record(null::public.events, p_event);
  select * into row from public.events where id = snapshot.id for update;
  if not found then
    insert into public.google_event_tombstones(user_id, google_account_id, google_calendar_id, google_event_id)
      select c.user_id, c.google_account_id, c.google_calendar_id, p_google->>'id'
      from public.calendars c where c.id = snapshot.calendar_id and c.user_id = snapshot.user_id and c.source = 'google';
    return null;
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
-- Two incoming requests may both have observed no local row. Serialize the
-- insert check without deleting any pre-existing duplicate/legacy rows.
create function public.insert_google_event_once(p_event jsonb)
returns text language plpgsql security invoker set search_path = public as $$
declare row public.events;
begin
  row := jsonb_populate_record(null::public.events, p_event);
  perform pg_advisory_xact_lock(hashtextextended(row.calendar_id::text || ':' || row.google_event_id, 4734));
  if exists(select 1 from public.events where calendar_id = row.calendar_id and google_event_id = row.google_event_id) then return 'updated'; end if;
  insert into public.events(user_id, calendar_id, google_event_id, title, notes, start_time, end_time,
    timezone, is_all_day, location, visibility, privacy, conferencing_url, recurrence_rule,
    recurrence_id, recurrence_exceptions, attendees, reminders, status, sync_status, etag)
  values(row.user_id, row.calendar_id, row.google_event_id, row.title, row.notes, row.start_time, row.end_time,
    row.timezone, row.is_all_day, row.location, row.visibility, row.privacy, row.conferencing_url,
    row.recurrence_rule, row.recurrence_id, coalesce(row.recurrence_exceptions, '{}'), row.attendees,
    row.reminders, row.status, 'synced', row.etag);
  return 'created';
end;
$$;
revoke all on function public.prepare_event_push(uuid) from public, anon, authenticated;
revoke all on function public.finish_event_push(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.insert_google_event_once(jsonb) from public, anon, authenticated;
grant execute on function public.prepare_event_push(uuid) to service_role;
grant execute on function public.finish_event_push(jsonb, jsonb) to service_role;
grant execute on function public.insert_google_event_once(jsonb) to service_role;
