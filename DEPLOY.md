# Self-hosting Meowlendar

You run your own copy with your own Supabase and your own Google client. There is no shared hosted database.

Meowlendar was renamed from Poolendar. Internal package names (`@poolendar/*`) keep the old name on purpose.

## 1. Run it locally

Needs Node 22+, pnpm, the Supabase CLI, and a running Docker (Docker Desktop or `colima start`).

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

**You don't need Google.** Every account starts with a local calendar. Events, recurring events, tasks, routines, the board, booking links and the MCP all work on it. Add more under **Settings > Calendars**.

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

**Settings > Calendars > Connect Google Account.** Repeat for each account. The code has no limit on accounts, and Google shows an account picker each time. Every calendar on the account comes in, and you can turn each one off in the same place.

## 3. Automatic sync

Once an account is connected, sync runs by itself. Every calendar on the account comes in on first connect, and you can turn each one on or off under **Settings > Calendars**. **Resync** stays there as a manual button.

- **On a plain server (`pnpm dev`, `next start`):** the app runs its own jobs. It syncs every 5 minutes and sends reminders every minute. Set `SCHEDULER_INTERVAL_SECONDS` to change the sync interval, or `0` to turn it off and use your own scheduler. If you run several instances, a lease in the database stops them doubling up.
- **On Vercel:** there's no long-running process, so `vercel.json` schedules the sync routes with Vercel Cron, using your `CRON_SECRET`. Hobby plans only allow daily crons, so that's what it ships with. Google push webhooks and the open app fill the gaps: an open tab syncs every 2 minutes. **Reminders need a per-minute schedule**, so on Hobby use an outside scheduler for `/api/cron/reminders`. On Pro, you can tighten the schedules in `vercel.json`.
- **Any other scheduler:** each route is a GET with `Authorization: Bearer $CRON_SECRET`:

| Route | How often | What it does |
|---|---|---|
| `/api/cron/sync-poll` | every 5 minutes | Pulls Google changes, pushes changes made here |
| `/api/cron/webhook-renewal` | daily | Renews Google push channels |
| `/api/cron/reminders` | every minute | Sends due reminders |

Google push webhooks need a public HTTPS URL with a valid certificate, so they don't run on localhost. They watch each account's primary calendar and trigger a sync of the whole account; other calendars update on the next scheduled sync.

### Tasks on Google

Scheduled tasks can appear on a Google calendar you choose, under **Settings > Calendars > Tasks on Google**. It's off until you pick one, and choosing **Off** takes the mirrored events back down. Tasks reach Google on the next sync: within 2 minutes while the app is open, otherwise on the scheduled job.

If both sides change a task between syncs, the change in Meowlendar wins. Moving or renaming the event on Google updates the task. Deleting it on Google unschedules the task and keeps it.

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
6. **Realtime > Settings**: turn off **Allow public access**. Notifications use private channels.
7. Create `apps/web/.env.local` from the table in section 6.

API keys and the MCP need only the service role key and the public key, on old and new projects alike. If you set `SUPABASE_JWT_SECRET` on an earlier version, you can delete it: nothing reads it now, and existing API keys keep working.

## 5. Deploy the app (optional)

Any host that runs Next.js works. On Vercel:

1. Fork the repo and import it.
2. Set **Root Directory** to `apps/web`.
3. Add the variables from section 6.
4. Set `NEXT_PUBLIC_APP_URL` to your final URL, with no trailing slash. It is built into the app, so redeploy after changing it.
5. Add the hosted redirect URI from section 2 and the Supabase URLs from section 4.

Booking pages are served at `/book/<slug>`. Each slug is unique across the install.

### Subdomain booking pages (optional)

`you.example.com/30min` opens the same page as `/book/30min`, and `you.example.com` lists your public links. `you` is the username in **Settings > Profile**, and a link only opens under its owner's name. To turn it on:

1. Point a wildcard at your host: a `CNAME` for `*.example.com`. On Vercel, also add `*.example.com` under **Project Settings > Domains**, which requires the domain to use Vercel's nameservers.
2. The booking domain defaults to your `NEXT_PUBLIC_APP_URL` host, with a leading `app.` or `www.` removed. To use a different one, set `BOOKING_ROOT_DOMAIN`.

**The app refuses any Host header it doesn't recognise with a 421.** It accepts your app host, the booking domain and its subdomains. On a server behind a proxy, the proxy must pass the original host (`proxy_set_header Host $host` on nginx). List any other names, such as an internal health check, in `ALLOWED_HOSTS`.

Locally, `you.localhost:3000/30min` works with no DNS.

Read `SECURITY.md` before exposing an install to the internet. Security headers are set in `apps/web/next.config.js`, so they apply on any host. `NEXT_PUBLIC_SUPABASE_URL` must be set at build time for the Content Security Policy to allow your Supabase project.

## 6. Environment variables

The app reads `apps/web/.env.local`. A `.env` at the repo root is not read.

| Variable | Required | Where it comes from |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | yes | Your app URL, no trailing slash |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Publishable key (`sb_publishable_...`) or legacy anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Secret key (`sb_secret_...`) or legacy service role key. Server only |
| `GOOGLE_TOKEN_ENC_KEY` | yes | `openssl rand -base64 32`. Encrypts Google tokens and API key sessions. Changing it orphans stored tokens |
| `GOOGLE_CLIENT_ID` | for Google | Section 2 |
| `GOOGLE_CLIENT_SECRET` | for Google | Section 2 |
| `SCHEDULER_INTERVAL_SECONDS` | no | Built-in sync interval. `0` turns it off. Ignored on Vercel |
| `CRON_SECRET` | for outside schedulers and Vercel Cron | `openssl rand -hex 32` |
| `GOOGLE_WEBHOOK_SECRET` | for push sync | `openssl rand -hex 32` |
| `RESEND_API_KEY` | for email | Resend. Without it, booking emails are only logged |
| `RESEND_FROM_EMAIL` | for email | An address on a domain you verified with Resend. The default will fail for you |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | for push alerts | `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | for push alerts | Same command |
| `VAPID_SUBJECT` | for push alerts | `mailto:you@example.com` |
| `BOOKING_ROOT_DOMAIN` | no | Domain for subdomain booking pages. Defaults to the app host |
| `ALLOWED_HOSTS` | no | Comma-separated extra hosts the app answers on |
| `TRUSTED_IP_HEADER` | behind a non-Vercel proxy | Header your proxy overwrites, such as `x-real-ip`. See `SECURITY.md` |

## 7. Connect the MCP

Build it from your clone:

```bash
pnpm --filter meowlendar-mcp build
```

Create a key in the app under **Settings > API Keys**. It is shown once. Then register it, using the absolute path to your clone:

```bash
claude mcp add meowlendar -s user \
  --env MEOWLENDAR_API_KEY=pk_your_key \
  --env MEOWLENDAR_API_URL=http://localhost:3000 \
  -- node /absolute/path/to/meowlendar/packages/mcp/dist/index.js
```

`claude mcp list` should show `meowlendar` as connected. The app must be running for the tools to work. See `packages/mcp/README.md`.

## 8. Link an Obsidian vault (optional)

The 2ndBrain link keeps Obsidian Tasks lines in a vault folder and your tasks in two-way sync. It works on any Obsidian vault using the Obsidian Tasks plugin format. A hosted app can't reach your files, so it runs on your machine and talks to your instance with an API key.

Migration `030_task_vault_ref.sql` has to be applied first (`pnpm setup:local`, or `supabase db push` on a hosted project).

```bash
pnpm --filter meowlendar-mcp build
export MEOWLENDAR_API_KEY=pk_your_key
export MEOWLENDAR_API_URL=http://localhost:3000
node packages/mcp/dist/vault-cli.js connect --name work --vault /absolute/path/to/vault --folder Tasks
node packages/mcp/dist/vault-cli.js plan --name work
node packages/mcp/dist/vault-cli.js apply --name work --plan <id from the plan>
```

Once the package is installed, the same command is `meowlendar-vault`.

- **Dry run.** `plan` writes nothing. It shows every line and app change, the conflicts, what was removed or deleted on each side, and what it skipped. `apply` refuses if anything changed since that plan.
- **Conflict rule.** If both sides changed the same field since the last sync, the vault wins, and the app value that lost is listed under `conflicts`. A field changed on only one side flows to the other.
- **Backups.** Every file about to change and the state file are copied to `<vault>/.meowlendar/backups/<timestamp>/` first. If that fails, nothing is written. Old backups are not pruned.
- **Deletes.** Nothing deletes a line or a task. A removed line unlinks its task, and a deleted task marks its line `[-]`.
- **Rate limit.** The app allows 100 writes per minute per key. A first sync bigger than that stops at the limit. Run `plan` and `apply` again a minute later to continue.

See `packages/mcp/README.md` for the field mapping and path rules.
