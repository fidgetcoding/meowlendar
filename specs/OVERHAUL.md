# OVERHAUL.md — Poolendar Full Overhaul (2026-07-03)

Execution tracker for the 7-phase overhaul. Canonical product spec: `specs/PRODUCT.md` + `specs/TECH.md`
(restored verbatim from the vault on 2026-07-03 — the in-repo copies had been rewritten by commit `5a60c5b`
to legitimize scope creep; do not trust any spec text from that commit).

Pre-overhaul state is tagged `pre-overhaul` (= `efa5cbc`). All deleted code remains recoverable there.

## Diagnosis (from 4-agent audit, 2026-07-02)

Three failure layers:

1. **Dead integration layer.** High-quality components (ItemEditForm 994L, PreviewPopover,
   RecurrenceEditDialog, undo engine) exist and pass tests but were never mounted/wired.
   `page.tsx:58` hardcodes `calendars = []`; grid handler props never passed; command bar ~90% no-op;
   kanban unreachable on desktop; `pushOperation` never called. 1,255 unit tests passed while zero
   user flows worked — no E2E existed.
2. **Amputated sync.** `efa5cbc` deleted the entire `/api/google/*` tree + all crons (incl. reminders
   schedule). `lib/google/{oauth,calendar,sync}.ts` survive as orphaned dead code. No calendars can be
   connected → `POST /api/events` 404s app-wide.
3. **Broken API thesis.** Spec #22 fails via REST (`GET /api/events` never unions scheduled tasks;
   browser works only because hooks bypass REST). API-key path used a service-role client bypassing RLS
   (fixed: requests now run as the user through a short-lived JWT). Google tokens were plaintext
   (fixed: AES-256-GCM in `lib/crypto.ts`). Rate limiting only on 5 public routes.
   MCP not npx-installable.

Plus ~2,942 LOC scope creep (Frames, auto-schedule engine, Anthropic classifier) against explicit
v1 non-goals.

## Standing decisions

- **Rewire, don't rebuild.** Schema/RLS/indexes, packages, and component library are kept.
- **E2E-gated phases.** Every phase from 4 on exits through Playwright flows tied to spec invariant
  numbers. Unit tests alone never justify "done" — that discipline failure caused this mess.
- **Offline (#72i-j) cut from v1.** Queue was never wired; revisit post-ship.
- **Crons via n8n** hitting `CRON_SECRET`-protected route handlers (not Vercel Pro crons).
- **Booking URLs path-based** `/book/{slug}` for now (spec's documented fallback); wildcard subdomains later.
- **Creep code deleted from main** (recoverable at `pre-overhaul` tag).
- **API keys stay SHA-256** (fine for 128-bit random keys); TECH.md amended rather than moving to bcrypt.
- **OAuth architecture (updated 2026-11-05):** Google sign-in requests calendar scopes in the same consent. The server validates the Google identity, stores calendar tokens encrypted, and removes provider tokens from the browser session. The dedicated Google Connect flow remains available for email users and additional accounts. This supersedes the earlier login-only decision.
- **Cloud footprint is gone (discovered 2026-07-03):** the original Supabase and Vercel projects no
  longer exist. The schema is fully recoverable from migrations. Unit tests are DB-mocked, so Phases
  1-3 proceed; a real backend is required by Phase 4's E2E gate. A new project must keep a legacy
  HS256 JWT secret available (`SUPABASE_JWT_SECRET`) for the Phase 2 API-key to user-JWT auth design.

- **NO Google OAuth and NO paid database until Nate says otherwise (2026-07-03, his call).**
  He wants to mess around with the app on the free local stack first. Email/password auth +
  local Supabase cover everything except Google sync. Do not set up Google Cloud credentials,
  do not create the $10/mo Supabase project, do not deploy — Phase 7 and the Google-sync
  E2E verification wait for his explicit go.

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | Demolition + spec restore | DONE 2026-07-03 |
| 2 | Security foundation | DONE 2026-07-03 |
| 3 | Resurrect Google sync | DONE 2026-07-03 |
| 4 | The Great Rewiring (UI) | DONE 2026-07-03 — E2E gate green 17/17 (auth+seed setup projects, flows #12-15/kanban/command-bar) 3 consecutive runs vs live local stack |
| 5 | API contract + MCP | DONE 2026-07-03 — #22 proven live via REST AND installed MCP binary (task w/ scheduled times → events range query, kind=task); 59 tools; tarball-install verified; npm publish deferred per directive |
| 6 | Booking + notifications | DONE 2026-07-03 — #56 shared pool proven live; approval/decline/cancel flows verified; ICS emails in Resend log-only mode; freeBusy PENDING-LIVE-VERIFICATION (needs OAuth); E2E 18/18 |
| 7 | Ship + guard | PARKED — awaits Nate's explicit go (see go-signals below) |

### Phase 7 go-signals (nothing proceeds without Nate saying so)

1. **Google OAuth** — "set up google oauth": create Google Cloud OAuth client, add redirect
   URIs (localhost + prod), put GOOGLE_CLIENT_ID/SECRET in env. Unlocks: calendar connect,
   event sync, freeBusy live verification, invite sending.
2. **Hosted Supabase** — "create the supabase project".
   Needs legacy HS256 JWT secret enabled for the API-key auth design. Apply migrations 001-014.
3. **Deploy** — "deploy it": new Vercel project, poolendar.com DNS via Cloudflare, real env
   secrets (Resend, VAPID, CRON_SECRET), n8n cron schedules for reminders/sync-poll/webhook-renewal,
   SW network-first fix, Playwright in CI.
4. **npm publish** — "publish the mcp": poolendar-mcp to npm (currently tarball-verified only).

### Phase 1 — Demolition + spec restore
- Restore vault specs (done), tag pre-overhaul (done)
- Delete Frames (routes, FramesTab, types, validators, 6 MCP tools), auto-schedule engine
  (routes, lib/auto-schedule, 5 MCP tools), AI classifier (classifier-llm.ts, classify route)
- KEEP: `schedules` table + `/api/schedules` (spec placeholder), AvailabilityTab, `/api/undo`,
  `/api/notifications`, `/api/cron/reminders`
- Migration 009: drop frames/frame_keywords/frame_corrections; drop tasks.frame_id,
  tasks.auto_scheduled, tags.priority_rank
- Test scripts get `--run` (root `pnpm test` currently hangs); fix 7 rate-limiter test failures
  (reset in beforeEach)
- Gate: typecheck 0 errors, turbo build green, full vitest run green

### Phase 2 — Security foundation
- RLS bypass fix: API-key requests get a user-scoped Supabase JWT (if legacy JWT secret available)
  or hardened per-handler scoping + exhaustive cross-tenant integration tests
- Encrypt google_accounts tokens (app-layer AES-GCM, key in env)
- Rate limiting on authenticated surface (#78) + Retry-After
- Migration: bookings.updated_at (fixes two live 500s)
- RSVP fix under API-key auth; tag_ids ownership check; events UPDATE/DELETE user scoping

### Phase 3 — Resurrect Google sync
- Restore /api/google/* from `efa5cbc^`; rework per OAuth architecture decision
- Wire lib/google/sync.ts: webhook route, poll fallback, webhook renewal, pending_push retry
- Create /api/calendars (list/connect/disconnect) — never existed
- Boot-time env validation, fail loudly (placeholder-env silent failures banned)

### Phase 4 — The Great Rewiring
- page.tsx/layout.tsx assembly: mount dead components, pass grid handler props, real calendars in
- Undo live (pushOperation in every mutation hook); command bar real actions; desktop kanban toggle
- Display toggles honored by grid; settings single read-write source (merge calendar-store)
- Full keyboard set (#71); complete context menus (#15a-b); sidebar grouping fix (#30);
  multi-day bars (#15d); 2-week/custom views (#4)
- Playwright E2E: spec flows #12, #13, #14, #15 in a real browser

### Phase 5 — API contract + MCP
- #22 for real: scheduled tasks appear in events date-range query (spec's own acceptance test)
- /api/tasks/reflow; list_calendars + reflow_day MCP tools; client/route body mismatch fixes;
  cursor pagination (#76); 422 (#77); Postgres RPC transactions for multi-table writes
- MCP npx-installable: tsup single-file bundle, npm publish, POOLENDAR_API_URL env

### Phase 6 — Booking + notifications
- Shared availability pool (#56) + live Google freeBusy, fail-closed; buffers; min-notice
- Approval flow (approve endpoint; no invite before approval); confirmation email + ICS +
  cancel/reschedule links (Resend, in-route not edge function)
- Drag-to-paint availability editor; in-app booking panel (ribbon/⌥S currently dead-end)
- Reminders cron via n8n; real VAPID/Resend keys

### Phase 7 — Ship + guard
- Vercel deploy + poolendar.com restored; SW network-first for JS/CSS (stale-bundle fix)
- Playwright in CI as merge gate
- Acceptance: fresh account → connect Google → events appear → MCP create_task with times → on grid

## Key defect index (audit citations)

- `apps/web/app/(app)/page.tsx:58` — hardcoded `calendars = []`
- `apps/web/app/(app)/page.tsx:193-205` — grid handler props never passed
- `apps/web/lib/auth/helpers.ts:19-30` — service-role client on API-key path (RLS bypass). Fixed.
- `supabase/migrations/001_initial_schema.sql:48-49` — plaintext Google tokens. Fixed in `lib/crypto.ts`.
- `apps/web/app/api/events/route.ts:79-84` — event create 404s with empty calendars
- `apps/web/app/api/booking/availability/[slug]/route.ts:167` — single-link availability (no #56 pool)
- `apps/web/app/api/booking/book/[slug]/route.ts:215-234` — no email/ICS/notification on booking
- `apps/web/app/api/events/[id]/rsvp/route.ts:46` — auth.getUser() null under API key → silent no-op
- `packages/mcp/package.json:20-22` — private workspace deps block npx install
- `apps/web/lib/offline/sync.ts:28` — queueMutation zero callers (offline cut from v1)
