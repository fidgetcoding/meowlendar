-- API keys used to run as their user through an HS256 token signed with the
-- project's legacy JWT secret, which new Supabase projects may not have. Each key
-- now holds a real Auth session instead. Existing keys keep working as they are;
-- a session is created on a key's first use.
--
-- Tokens are encrypted by the app before they get here. RLS is on with no
-- policies, so only the service role can touch this table.
create table public.api_key_sessions (
  key_id uuid primary key references public.api_keys(id) on delete cascade,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.api_key_sessions enable row level security;

revoke all on public.api_key_sessions from anon, authenticated;
