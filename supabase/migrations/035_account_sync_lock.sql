-- One incoming stream per account, with ownership tokens for renewal/release.
create table public.account_sync_locks (
  account_id uuid primary key references public.google_accounts(id) on delete cascade,
  token uuid not null, held_until timestamptz not null
);
alter table public.account_sync_locks enable row level security;
revoke all on public.account_sync_locks from anon, authenticated;
create function public.claim_account_sync(p_account uuid) returns uuid
language sql security invoker set search_path = public as $$
  insert into public.account_sync_locks(account_id, token, held_until)
  values(p_account, gen_random_uuid(), clock_timestamp() + interval '5 minutes')
  on conflict (account_id) do update set token = excluded.token, held_until = excluded.held_until
    where account_sync_locks.held_until < clock_timestamp()
  returning token;
$$;
create function public.renew_account_sync(p_account uuid, p_token uuid) returns boolean
language plpgsql security invoker set search_path = public as $$
begin
  update public.account_sync_locks set held_until = clock_timestamp() + interval '5 minutes'
    where account_id = p_account and token = p_token and held_until > clock_timestamp();
  return found;
end;
$$;
create function public.release_account_sync(p_account uuid, p_token uuid) returns void
language sql security invoker set search_path = public as $$
  delete from public.account_sync_locks where account_id = p_account and token = p_token;
$$;
revoke all on function public.claim_account_sync(uuid), public.renew_account_sync(uuid, uuid), public.release_account_sync(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_account_sync(uuid), public.renew_account_sync(uuid, uuid), public.release_account_sync(uuid, uuid) to service_role;
