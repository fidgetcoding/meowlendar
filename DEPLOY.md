# Self-hosting Meowlendar

You run your own copy with your own Supabase and your own Google client. There is no shared hosted database.

Meowlendar was renamed from Poolendar. Package names (`@poolendar/*`), the `poolendar-mcp` binary, and the `POOLENDAR_*` variables keep the old name on purpose.

## 1. Run it locally

Needs Node 20+, pnpm, the Supabase CLI, and a running Docker (Docker Desktop or `colima start`).

```bash
git clone https://github.com/fidgetcoding/meowlendar
cd meowlendar
pnpm install
pnpm setup:local
pnpm dev
```

`pnpm setup:local` checks the tools above, starts Supabase, applies the migrations, and writes `apps/web/.env.local`. Re-running it keeps your secrets and anything you added by hand.

Open http://localhost:3000, click **Sign up**, and create an account with any email and password. Local email confirmation is off. If you turn it on, the mail lands at http://127.0.0.1:54324.

Use `localhost`, not `127.0.0.1`, in the browser. Sessions are per host and the Google callback uses `NEXT_PUBLIC_APP_URL`.

**Without Google you get tasks, the board, and booking links, but no events.** Every event belongs to a calendar, and calendars only come from a connected Google account.

## 2. Google Cloud setup

One OAuth client covers both jobs: signing in (through Supabase) and connecting calendars (through the app). They are separate flows. You can sign in with email and still connect Google calendars.

In the [Google Cloud console](https://console.cloud.google.com):

1. Create a project.
2. **APIs & Services > Library**: enable **Google Calendar API**.
3. **Google Auth Platform > Branding**: set the app name and contact emails.
4. **Audience**: choose **External**. Add every Google account you plan to connect under **Test users**.
5. **Data Access > Add or remove scopes**, add:
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
   - `.../auth/calendar.events`
   - `.../auth/calendar.readonly`
   - `.../auth/calendar.settings.readonly`
6. **Clients > Create client**, type **Web application**.
   - **Authorized JavaScript origins**: your app URL, such as `http://localhost:3000`.
   - **Authorized redirect URIs**, exact strings, only the ones you use:

   | Purpose | Local | Hosted |
   |---|---|---|
   | Sign-in through Supabase | `http://127.0.0.1:54321/auth/v1/callback` | `https://<project-ref>.supabase.co/auth/v1/callback` |
   | Calendar connect | `http://localhost:3000/api/google/callback` | `https://<your-domain>/api/google/callback` |

7. Copy the client ID and secret.

**Publish to avoid weekly logouts.** While the app is in Testing, Google expires refresh tokens after 7 days, so connected calendars stop syncing. For long-term use, click **Audience > Publish app**. Without verification, Google shows an "unverified app" warning you can click through (**Advanced > Go to app**).

### Add the credentials locally

Calendar connect, in `apps/web/.env.local`:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

Sign-in with Google, in `supabase/.env` (gitignored):

```
SUPABASE_AUTH_EXTERNAL_GOOGLE_ENABLED=true
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=...
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=...
```

Then run `supabase stop && supabase start` and restart `pnpm dev`.

If you skip this, **Continue with Google** shows a raw `provider is not enabled` message and **Connect Google Account** returns `Google Calendar is not configured on this deployment`.

### Connect calendars

**Settings > Calendars > Connect Google Account.** Repeat for each account. The code has no limit on accounts, and Google shows an account picker each time. Connecting pulls the primary calendar. Press **Resync** on the account to pull its other calendars.

## 3. Keep sync running

Three routes need a scheduler. Nothing in this repo schedules them, so without one Google changes only arrive when you press **Resync**, and reminders never fire. Each one is a GET with `Authorization: Bearer $CRON_SECRET`:

| Route | How often | What it does |
|---|---|---|
| `/api/cron/sync-poll` | every 5 to 10 minutes | Pulls Google changes, retries failed pushes |
| `/api/cron/webhook-renewal` | daily | Renews Google push channels |
| `/api/cron/reminders` | every minute | Sends due reminders |

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<your-domain>/api/cron/sync-poll
```

Any scheduler works: crontab, GitHub Actions, n8n, or Vercel Cron if your plan allows these intervals. Google push webhooks need a public HTTPS URL with a valid certificate, so they do not work on localhost.

## 4. Hosted Supabase, no Docker

1. Create a project at [supabase.com](https://supabase.com).
2. Push the schema:
   ```bash
   supabase login
   supabase link --project-ref <project-ref>
   supabase db push
   ```
3. **Authentication > URL Configuration**: set **Site URL** to your app URL, and add `<your app URL>/callback` under **Redirect URLs**.
4. **Authentication > Providers > Google**: enable it and paste the client ID and secret.
5. Hosted Supabase confirms emails by default and its built-in mailer is heavily rate limited. Add your own SMTP, or turn confirmation off for a personal install.
6. Create `apps/web/.env.local` from the table in section 6.

**API keys and the MCP need `SUPABASE_JWT_SECRET`.** The app signs a short-lived HS256 token for each API-key request. Copy the legacy JWT secret from **Project Settings > JWT Keys**. A project without a legacy HS256 secret will not be able to serve API keys or the MCP as built.

## 5. Deploy the app (optional)

Any host that runs Next.js works. On Vercel:

1. Fork the repo and import it.
2. Set **Root Directory** to `apps/web`.
3. Add the variables from section 6.
4. Set `NEXT_PUBLIC_APP_URL` to your final URL, with no trailing slash. It is built into the app, so redeploy after changing it.
5. Add the hosted redirect URI from section 2 and the Supabase URLs from section 4.

Booking pages are served at `/book/<slug>`. Subdomain booking pages (`you.example.com`) do not work, so no wildcard DNS is needed.

## 6. Environment variables

The app reads `apps/web/.env.local`. A `.env` at the repo root is not read.

| Variable | Required | Where it comes from |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | yes | Your app URL, no trailing slash |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Publishable key (`sb_publishable_...`) or legacy anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Secret key (`sb_secret_...`) or legacy service role key. Server only |
| `SUPABASE_JWT_SECRET` | yes | Legacy JWT secret. Needed for API keys and the MCP |
| `GOOGLE_TOKEN_ENC_KEY` | yes | `openssl rand -base64 32`. Encrypts Google tokens. Changing it orphans stored tokens |
| `GOOGLE_CLIENT_ID` | for Google | Section 2 |
| `GOOGLE_CLIENT_SECRET` | for Google | Section 2 |
| `CRON_SECRET` | for sync | `openssl rand -hex 32` |
| `GOOGLE_WEBHOOK_SECRET` | for push sync | `openssl rand -hex 32` |
| `RESEND_API_KEY` | for email | Resend. Without it, booking emails are only logged |
| `RESEND_FROM_EMAIL` | for email | An address on a domain you verified with Resend. The default will fail for you |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | for push alerts | `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | for push alerts | Same command |
| `VAPID_SUBJECT` | for push alerts | `mailto:you@example.com` |

## 7. Connect the MCP

The server is not on npm. Build it from your clone:

```bash
pnpm --filter poolendar-mcp build
```

Create a key in the app under **Settings > API Keys**. It is shown once. Then register it, using the absolute path to your clone:

```bash
claude mcp add meowlendar -s user \
  --env POOLENDAR_API_KEY=pk_your_key \
  --env POOLENDAR_API_URL=http://localhost:3000 \
  -- node /absolute/path/to/meowlendar/packages/mcp/dist/index.js
```

`claude mcp list` should show `meowlendar` as connected. The app must be running for the tools to work. See `packages/mcp/README.md`.
