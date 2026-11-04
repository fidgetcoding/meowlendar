-- A new local edit starts a fresh retry budget. A delayed failure from an older
-- push must not exhaust the new edit's retries.
create function public.reset_event_edit_retry()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.sync_status = 'pending_push' and
    (to_jsonb(new) - array['updated_at','sync_status','etag','google_event_id','retry_count','next_retry_at']) is distinct from
    (to_jsonb(old) - array['updated_at','sync_status','etag','google_event_id','retry_count','next_retry_at']) then
    new.retry_count := 0;
    new.next_retry_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.reset_event_edit_retry() from public, anon, authenticated;
create trigger reset_event_edit_retry before update on public.events
  for each row execute function public.reset_event_edit_retry();
