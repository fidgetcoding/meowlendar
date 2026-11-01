-- 030: link tasks to a line in an Obsidian vault (the 2ndBrain link)
--
-- vault_ref is "<vault name>:<line id>". The local sync tool sets it so a task
-- and its line can find each other again on every sync. It is unique per user,
-- so a retried create can never produce a second task for the same line.
--
-- create_task_with_children whitelists columns, so it has to be replaced for a
-- create to keep vault_ref. The sync also carries a line's completion date, so
-- the function now honors a supplied completed_at for a done task and falls back
-- to now() as before. Same signature, so the grants from 013 stay in place.

alter table public.tasks add column if not exists vault_ref text;

create unique index if not exists idx_tasks_user_vault_ref
  on public.tasks (user_id, vault_ref)
  where vault_ref is not null;

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
    user_id, title, notes, calendar_id, importance, time_estimate_minutes,
    earliest_start, due_date, due_date_recurrence, scheduled_start, scheduled_end,
    location, visibility, privacy, flexibility, status, board, reminders, completed_at,
    vault_ref
  ) values (
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
    p_task->>'vault_ref'
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
