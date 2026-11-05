-- A task create can carry the id the browser chose for it. The page sends a just-made task again
-- while it unloads (a reload right after Enter), and the shared id turns the second insert into a
-- primary-key conflict the API answers with the existing task, never a second copy.
--
-- The create RPC from 042, unchanged except that it takes p_task.id when one is given.
create or replace function public.create_task_with_children(
  p_task jsonb,
  p_tag_ids uuid[] default '{}',
  p_subtasks jsonb default '[]'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_task public.tasks;
  v_status text := coalesce(p_task->>'status', 'backlog');
  v_tags jsonb;
  v_subtasks jsonb;
begin
  if v_user_id is null then
    raise exception 'not authenticated' using errcode = 'PT401';
  end if;

  insert into public.tasks (
    id, user_id, title, notes, calendar_id, importance, time_estimate_minutes,
    earliest_start, due_date, due_date_recurrence, scheduled_start, scheduled_end,
    location, visibility, privacy, flexibility, status, board, reminders, completed_at,
    vault_ref, parent_id, position, is_split, created_via
  ) values (
    coalesce((p_task->>'id')::uuid, gen_random_uuid()),
    v_user_id,
    p_task->>'title',
    p_task->>'notes',
    (p_task->>'calendar_id')::uuid,
    coalesce(p_task->>'importance', 'normal'),
    (p_task->>'time_estimate_minutes')::int,
    (p_task->>'earliest_start')::date,
    (p_task->>'due_date')::date,
    p_task->>'due_date_recurrence',
    (p_task->>'scheduled_start')::timestamptz,
    (p_task->>'scheduled_end')::timestamptz,
    p_task->>'location',
    coalesce(p_task->>'visibility', 'busy'),
    coalesce(p_task->>'privacy', 'private'),
    coalesce(p_task->>'flexibility', 'flexible'),
    v_status,
    coalesce(p_task->>'board', 'current'),
    coalesce(p_task->'reminders', '[]'::jsonb),
    case
      when v_status = 'done' then coalesce((p_task->>'completed_at')::timestamptz, now())
      else null
    end,
    p_task->>'vault_ref',
    (p_task->>'parent_id')::uuid,
    coalesce((p_task->>'position')::double precision, 0),
    coalesce((p_task->>'is_split')::boolean, false),
    p_task->>'created_via'
  )
  returning * into v_task;

  if array_length(p_tag_ids, 1) is not null then
    insert into public.task_tags (task_id, tag_id)
    select v_task.id, unnest(p_tag_ids);
  end if;

  if jsonb_typeof(p_subtasks) = 'array' and jsonb_array_length(p_subtasks) > 0 then
    insert into public.subtasks (task_id, title, time_estimate_minutes, completed, position)
    select
      v_task.id,
      elem->>'title',
      (elem->>'time_estimate_minutes')::int,
      false,
      ord::float8
    from jsonb_array_elements(p_subtasks) with ordinality as t(elem, ord);
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object('id', tg.id, 'name', tg.name, 'color', tg.color, 'prefix', tg.prefix)),
    '[]'::jsonb
  )
    into v_tags
  from public.task_tags tt
  join public.tags tg on tg.id = tt.tag_id
  where tt.task_id = v_task.id;

  select coalesce(jsonb_agg(to_jsonb(s.*) order by s.position), '[]'::jsonb)
    into v_subtasks
  from public.subtasks s
  where s.task_id = v_task.id;

  return to_jsonb(v_task) || jsonb_build_object('tags', v_tags, 'subtasks', v_subtasks);
end;
$$;
