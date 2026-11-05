# Security

## Reporting a vulnerability

Please report privately: email **nate@lorecraft.io**, or use **Security > Report a vulnerability** on the GitHub repository (<https://github.com/fidgetcoding/meowlendar/security/advisories/new>). Do not open a public issue. Include the steps to reproduce and what an attacker gains.

There is no hosted Meowlendar service. Every install is run by its owner, so a fix only reaches you when you pull it and apply new migrations.

## Secure your install

Run through this before putting an install on the internet.

**Supabase**
- Apply every migration with `supabase db push`. `015_security_hardening.sql` closes cross-user access and must be present.
- Turn off **Realtime > Settings > Allow public access**. Notifications use private channels, so nothing needs public ones.
- Keep email confirmation on, or turn off sign-ups, unless you trust everyone who can reach the URL. Signing up gives an account on your install.
- Use a password rule stronger than the 6-character local default.
- The service role key can act as any user. Keep it server-side only.

**App**
- Set `NEXT_PUBLIC_APP_URL` to your real URL. Redirects and Google callbacks depend on it.
- Behind a proxy that is not Vercel, set `TRUSTED_IP_HEADER` to the header your proxy controls, such as `x-real-ip`. Without it, all public booking visitors share one rate-limit bucket. Never name a header your proxy does not overwrite, because clients could then forge it.
- Generate `GOOGLE_TOKEN_ENC_KEY`, `CRON_SECRET` and `GOOGLE_WEBHOOK_SECRET` yourself, and never reuse them between installs.
- Serve over HTTPS.
- Behind a proxy, pass the original host through. The app refuses any Host header it doesn't recognise, with a 421.

**API keys**
- Keys give full access to the account, including managing other keys, and they do not expire. Create one per tool and delete any you stop using.

## How it is built

- Row Level Security is on for every table. Composite foreign keys stop a row from pointing at another user's Google account or calendar.
- The public anon key has no table or function access. Public booking goes through API routes that enforce availability and rate limits.
- API-key requests run as the key's user through a real Auth session, encrypted at rest, not the service role.
- Google tokens, API key sessions and Telegram bot tokens are encrypted with AES-256-GCM before they reach the database. Telegram tokens sit in a table only the server can read, and can only be changed from a browser session.
- Push notification addresses must belong to a known push service, so the server can't be pointed at its own network.
- Public booking subdomains serve booking pages only, and a link opens only under its owner's name.
- The MCP's vault tools take a vault name, never a path. Connecting a vault is CLI-only, and the sync only touches `.md` files inside the folder you named, with a dry run and a backup first.
- The MCP server validates every tool call against its schema, refuses arguments a tool doesn't declare, encodes path segments, and logs one line per call to stderr, without arguments.

## Known limits

- The Content Security Policy allows inline scripts, because the Next.js app has no nonce setup. It limits where data can go more than what can run.
- Browser sessions have no per-user rate limit. API keys do.
