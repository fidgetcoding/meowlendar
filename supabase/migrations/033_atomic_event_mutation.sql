-- A scoped recurrence edit (master + detached/new series) is one transaction.
create function public.mutate_event_series(p_id uuid, p_expected_updated_at timestamptz, p_patch jsonb, p_inserts jsonb default '[]', p_delete boolean default false)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare original public.events; changed public.events; inserted public.events; payload jsonb; result jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
  select * into original from public.events where id = p_id and user_id = auth.uid() for update;
  if not found then raise exception 'Event not found' using errcode = 'PT404'; end if;
  if original.updated_at is distinct from p_expected_updated_at then
    raise exception 'Event changed; reload before editing' using errcode = 'PT409';
  end if;
  if p_delete then
    delete from public.events where recurrence_id = p_id::text and user_id = auth.uid();
    delete from public.events where id = p_id;
    return null;
  end if;
  changed := jsonb_populate_record(original, p_patch);
  update public.events set
    calendar_id = changed.calendar_id, title = changed.title, notes = changed.notes,
    start_time = changed.start_time, end_time = changed.end_time, timezone = changed.timezone,
    is_all_day = changed.is_all_day, location = changed.location, color_override = changed.color_override,
    visibility = changed.visibility, privacy = changed.privacy, conferencing_url = changed.conferencing_url,
    recurrence_rule = changed.recurrence_rule, recurrence_exceptions = changed.recurrence_exceptions,
    attendees = changed.attendees, reminders = changed.reminders, status = changed.status,
    sync_status = 'pending_push'
  where id = p_id returning * into changed;
  result := to_jsonb(changed);
  for payload in select value from jsonb_array_elements(p_inserts) loop
    inserted := jsonb_populate_record(null::public.events, payload);
    insert into public.events(user_id, calendar_id, title, notes, start_time, end_time, timezone,
      is_all_day, location, color_override, visibility, privacy, conferencing_url, recurrence_rule,
      recurrence_id, recurrence_exceptions, attendees, reminders, status, sync_status)
    values(auth.uid(), inserted.calendar_id, inserted.title, inserted.notes, inserted.start_time,
      inserted.end_time, inserted.timezone, inserted.is_all_day, inserted.location, inserted.color_override,
      inserted.visibility, inserted.privacy, inserted.conferencing_url, inserted.recurrence_rule,
      inserted.recurrence_id, coalesce(inserted.recurrence_exceptions, '{}'), inserted.attendees,
      inserted.reminders, inserted.status, 'pending_push') returning * into inserted;
    result := to_jsonb(inserted);
  end loop;
  return result;
end;
$$;
revoke all on function public.mutate_event_series(uuid, timestamptz, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.mutate_event_series(uuid, timestamptz, jsonb, jsonb, boolean) to authenticated, service_role;
