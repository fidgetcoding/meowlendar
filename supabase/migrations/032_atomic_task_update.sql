-- Task fields and tag replacement commit together, under the caller's RLS.
create function public.update_task_with_tags(p_id uuid, p_patch jsonb, p_tag_ids uuid[] default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare current_task public.tasks; changed public.tasks; tags_json jsonb;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = 'PT401'; end if;
  select * into current_task from public.tasks where id = p_id and user_id = auth.uid() for update;
  if not found then raise exception 'Task not found' using errcode = 'PT404'; end if;
  if jsonb_typeof(p_patch) <> 'object' then raise exception 'Invalid patch' using errcode = 'PT400'; end if;
  changed := jsonb_populate_record(current_task, p_patch);
  update public.tasks set
    title = changed.title, notes = changed.notes, calendar_id = changed.calendar_id,
    parent_id = changed.parent_id, importance = changed.importance,
    time_estimate_minutes = changed.time_estimate_minutes, earliest_start = changed.earliest_start,
    due_date = changed.due_date, due_date_recurrence = changed.due_date_recurrence,
    scheduled_start = changed.scheduled_start, scheduled_end = changed.scheduled_end,
    location = changed.location, visibility = changed.visibility, privacy = changed.privacy,
    flexibility = changed.flexibility, status = changed.status, board = changed.board,
    is_split = changed.is_split, completed_at = changed.completed_at, position = changed.position,
    reminders = changed.reminders, vault_ref = changed.vault_ref
  where id = p_id returning * into changed;
  if p_tag_ids is not null then
    delete from public.task_tags where task_id = p_id;
    insert into public.task_tags(task_id, tag_id) select p_id, unnest(p_tag_ids);
  end if;
  select coalesce(jsonb_agg(to_jsonb(tg)), '[]'::jsonb) into tags_json
    from public.task_tags tt join public.tags tg on tg.id = tt.tag_id where tt.task_id = p_id;
  return to_jsonb(changed) || jsonb_build_object('tags', tags_json);
end;
$$;
revoke all on function public.update_task_with_tags(uuid, jsonb, uuid[]) from public, anon;
grant execute on function public.update_task_with_tags(uuid, jsonb, uuid[]) to authenticated, service_role;
