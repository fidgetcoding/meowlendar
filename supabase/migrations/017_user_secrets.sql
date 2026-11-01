-- Telegram bot tokens lived in profiles.settings as plain text, readable by the
-- browser. They move to a table only the service role can reach, where the app
-- stores them encrypted. SQL has no access to the app's encryption key, so an
-- existing token waits in the legacy column until the app next uses it, then gets
-- encrypted and cleared.
create table public.user_secrets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  telegram_bot_token text,
  telegram_bot_token_legacy text,
  updated_at timestamptz not null default now()
);

alter table public.user_secrets enable row level security;
revoke all on public.user_secrets from anon, authenticated;

insert into public.user_secrets (user_id, telegram_bot_token_legacy)
select id, settings->>'telegram_bot_token'
from public.profiles
where coalesce(settings->>'telegram_bot_token', '') <> '';

update public.profiles
set settings = settings - 'telegram_bot_token'
where settings ? 'telegram_bot_token';

-- Owners can write their own settings directly, so the column itself refuses it.
create function public.strip_profile_secrets()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.settings ? 'telegram_bot_token' then
    new.settings := new.settings - 'telegram_bot_token';
  end if;
  return new;
end;
$$;

create trigger strip_profile_secrets
  before insert or update of settings on public.profiles
  for each row execute function public.strip_profile_secrets();
