# How Meowlendar got built

My words are quoted as I wrote or said them, typos fixed, nothing else. Commit hashes are from this repo. "Private note" means a dated record I keep offline. 

## 1. The short version

An AI swarm built a whole calendar app in one day, June 13, 2026: 50+ API routes, 47 MCP tools, 1,200 tests. It looked amazing. Nothing worked. Three weeks later an audit found 1,255 passing unit tests and zero working user flows.

So on July 3 the rule changed: nothing is done until a real browser test says so. In one day, six phases rewired the app and proved the thing it was built for. A task created through the API landed on the calendar.

It went from a poop-emoji calendar called Poolendar, to a typo called Meowlander, to Meowlendar. On November 1 it became something a stranger can set up, and then I closed the list of what it was missing: local calendars, automatic sync, tasks on Google, the 2ndBrain link, an MCP you can pack for npm, and integration tests that hit a real database with fake outside services.

## 2. Origin, in my words

My reasons, as I gave them while this doc was being written (November 1, 2026): I hate paying for tools. Motion claimed to be a smart calendar and had no usable API at the time. Morgen was too expensive and lacking. I wanted tasks plus calendar, unlimited calendars, a link to my 2ndBrain, and $0. The cat name is for brainrot and meme value, and it's the base for anything I build that needs a calendar.

The spec's version (`specs/PRODUCT.md`):

> "Existing calendar apps have crippled APIs. Tasks created via Morgen's MCP land in the inbox, not on the calendar, forcing manual drag-and-drop."

My content notes (private note):

> "Tasks created via CLI go directly on the calendar, not the inbox. That's what Morgen can't do."

This is part three of a calendar trilogy. First I reverse-engineered how Motion's calendar worked, with Claude, to build an MCP for it. Then I rebuilt the MCP on Morgen's public API. Then I gave up and made my own.

## 3. Timeline

| Date (2026) | What happened | Evidence |
|---|---|---|
| Earlier 2026 | Motion MCP, then Morgen MCP | Separate repos |
| Jun 12 | Build written up as a content idea | Private note |
| Jun 13 | Scaffold, then the full app, then frames, auto-scheduling and an AI classifier, notifications, 1,200 tests, 15-agent audit fixes. Poop-emoji login | `896b624`, `7d55c31`, `5a60c5b`, `9892bb7`, `aac9f6a` |
| Jun 27 | Google OAuth, cron and Vercel stripped for localhost dev | `efa5cbc` |
| Jul 2 | Four-agent audit: three failure layers | `specs/OVERHAUL.md` |
| Jul 3 | Phase 1: scope creep deleted, specs restored | `5f85cc0` |
| Jul 3 | Phase 2: API keys run as the user, tokens encrypted, rate limits | `cabb911` |
| Jul 3 | Phase 3: Google sync layer back | `cec7754` |
| Jul 3 | Phase 4: grid, data, edit surfaces wired. E2E gate 17 of 17 | `f9ca3d8`, `d212046`, `35cbcaa` |
| Jul 3 | Phase 5: spec item #22 proven live over REST and the installed MCP | `ddc4316` |
| Jul 3 | Phase 6: booking, notifications. E2E 18 of 18. Domain registered that evening | `42c73bc`, private note |
| Jul 3 | My call: no OAuth, no paid database, no deploy until I say go | `51800e3` |
| Jul 25 | Meowlander rebrand, cat parade, light and dark themes, then the spelling fix | `5c7ea1a`, `51483ef` |
| Jul 25 | Silent task-create data loss fixed | `57e8120` |
| Aug 17 | Private details scrubbed from the tech spec | `fbed9d4` |
| Nov 1 | `pnpm setup:local`, API key fix, booking loop fix, works on your own domain | `924fb36`, `fa02015`, `83567a0`, `306a55a` |
| Nov 1 | Self-host guide and agent paste block | `eee5b73` |
| Nov 1 | Security pass: cross-user access, audit upgrades, booking limits, MCP schema enforcement, headers, auth redirects, SECURITY.md, CI, MIT, Node 22 | `04e8174`, `782a741`, `7795461`, `782382e`, `5e948b5`, `b0fd24f`, `2a98b25`, `3a78243` |
| Nov 1 | Lint passes, MCP packs for npx, API keys stop needing the legacy JWT secret, Telegram tokens encrypted, subdomain booking | `843c31a`, `f4088f0`, `8b9053c`, `108989d`, `10ab689` |
| Nov 1 | Local calendars and recurring events | `e60170a` |
| Nov 1 | Automatic sync, every calendar on connect, tasks on Google | `63d4a65`, `ee5d5d1`, `f6b1714` |
| Nov 1 | 2ndBrain link | `a7d5083` |
| Nov 1 | Integration tests against a real local stack with fake Google, Telegram, Resend and push | `17110ae`, `bfa9b79`, `cbe9ecf`, `4824dcc` |
| Nov 2 | Browser tests made headless and silent | `935c1d3` |


## 4. Round by round

### Round 1: the swarm (June 13)
- **Built:** everything, at once. API, MCP, calendar, kanban, auth, plus frames, auto-scheduling and an AI classifier that the spec said not to build.
- **Tested:** 1,200 unit tests, mocked. Multi-agent reviews.
- **Broke:** nobody could actually use it. `page.tsx:58` hardcoded `calendars = []`. Polished components were never mounted. The command bar was about 90% no-op. A prior commit (`5a60c5b`) had rewritten the specs to make the scope creep look legit.
- **Wanted next:** to mess with it locally, for free, which led to round 2.

### Round 2: amputation (June 27)
- **Built:** nothing. `efa5cbc` cut Google and cron to run on localhost.
- **Broke:** with no calendars, `POST /api/events` returned 404 across the app. The Supabase and Vercel projects had also vanished.
- **Wanted next:** the truth, so an audit.

### Round 3: the overhaul (July 2 and 3)
- **Diagnosis:** "1,255 unit tests passed while zero user flows worked. No E2E existed."
- **Built:** a 7-phase plan with standing rules. Rewire, don't rebuild. Every phase from 4 on exits through Playwright flows tied to spec numbers. Unit tests alone never justify "done".
- **Tested:** E2E 17 of 17, then 18 of 18, green multiple runs. 1,161 unit tests.
- **Broke along the way:** spec item #22 failed over REST, because `GET /api/events` never included scheduled tasks. API keys bypassed row security. Google tokens were in plaintext.
- **Fixed:** all three, and #22 proven through REST and the MCP binary.
- **Wanted next:** a real deploy, parked on my go.

### Round 4: cats (July 25)
- **Built:** rename, cat parade login, light as default and dark as the changeup.
- **Tested:** 639 of 639 web unit tests, 18 of 18 E2E.
- **Broke:** creating a task silently did nothing while the profile query was still loading (`57e8120`). `use-undo.ts` swallowed every failure. A pair of "pre-existing failures" turned out to be host routing reading `127` as a booking subdomain.
- **Wanted next:** nothing for a while. It sat parked.

### Round 5: a stranger can run it (November 1)
- **Built:** `pnpm setup:local`, a rewritten guide, the agent block, a security checklist, CI, Node 22 floor.
- **Tested:** from a fresh clone on an empty database. See section 6.
- **Broke, found by trying it fresh:**
  - API key creation in settings was broken (`fa02015`).
  - Booking slots looped forever east of UTC (`83567a0`).
  - The app only worked on specific hosts (`306a55a`).
  - An audit found any signed-up user could point rows at another user's Google account. That would have let them delete it or write to their calendar. Nothing was deployed, so nobody was exposed. Fixed with composite foreign keys in `04e8174`.
  - Node 20 can't run `supabase-js` scripts (`3a78243`).
- **Wanted next:** everything on the list below, the same day.

### Round 6: close the list (November 1 and 2)
- **Built:** a local calendar on every account, so events need no Google. Sync that runs by itself. Every calendar on an account, with a picker. Scheduled tasks mirrored to a Google calendar you choose. The 2ndBrain link: two-way Obsidian Tasks sync with a dry run, plan IDs and backups, as a CLI and three MCP tools.
- **Tested:** 137 integration tests on a real local Supabase and a production build of the app, with local fakes standing in for Google, Telegram, Resend and push. Every MCP tool gets called. Vault tests use temp vaults.
- **Broke:** creating an event while calendars loaded lost it (`58d46c3`). Concurrent syncs duplicated mirrored task events (`f6b1714`). A routine reminder test failed about one run in six depending on the clock's seconds, and fixing it properly also fixed reminders set more than an hour ahead (`4824dcc`).

## 5. Feature family tree

```
paying for Motion → reverse-engineered MCP → "why am I paying for this?"
└─ Morgen MCP → tasks land in the inbox, can't fix it from outside
   └─ own calendar, spec item #22: API tasks go on the grid
      ├─ REST API + API keys → MCP server (47 tools, then 63)
      ├─ calendar grid + tasks → kanban, command bar, keyboard
      ├─ booking pages → shared availability → approvals → ICS emails
      └─ Google sync (cut, then rebuilt)
   1,255 green tests, zero flows → E2E gate as the definition of done
   self-host decision → setup:local → agent paste block → SECURITY.md
   base for future builds → MIT, documented specs
```

## 6. Test log

| When | What | Result | Where |
|---|---|---|---|
| Jun 13 | Unit tests | 1,200, per commit message | `9892bb7` |
| Jul 2 | Audit snapshot | 1,255 pass, zero flows work | `specs/OVERHAUL.md` |
| Jul 3 | Unit + E2E | 1,161 unit, 18 of 18 E2E, green 4 runs in a row | Private note |
| Jul 25 | Web unit + E2E | 639 of 639, 18 of 18, typecheck 0 errors | Private note |
| Nov 1, before security pass | Fresh setup, real run | Sign-up, API key, MCP 59 tools listed, 4 called, task on grid | Setup report |
| Nov 1 | E2E | 18 passed, with one inserted calendar row since Google wasn't connected | Setup report |
| Nov 1 | Fake Google credentials | 503 when unset, right redirect, forged state and denied consent rejected | Setup report |
| Nov 1 | Cross-user probe, before and after | B inserting rows at A's account: allowed before, refused after. Anonymous read of booking links: allowed before, refused after | Session scripts |
| Nov 1, tip `3a78243` | Unit tests | Web 662, MCP 181, API client 88, validators 269. 1,200 total, all pass | Local run |
| Nov 2, `935c1d3` | Everything, empty database | Unit 1,601, E2E 24, integration 137 with fakes, lint clean, pack check OK | Local run and CI |

Yes, 1,200 twice. That's a coincidence, and a good reminder of how little the number means alone.

Trap to remember: without `E2E_BASE` set, the database specs skip themselves and the run looks green.

## 7. Roads not taken

- **Frames, auto-scheduling, the AI classifier.** About 2,942 lines, deleted. The spec said no, and it was right.
- **Rebuilding from scratch after the audit.** Rewired instead. Schema and components were good.
- **Offline queue.** Cut from v1, since it never had callers.
- **Bcrypt for API keys.** SHA-256 is fine for 128-bit random keys, and the spec was amended.
- **Hosting it for people.** I won't run a database for anyone.
- **Renaming internals.** 134 `poolendar` references stay, because renaming orphans caches and installed binaries.

## 8. My method

1. **Numbered spec, and the spec is law.** When a commit rewrote the spec to justify creep, the fix was restoring it from the vault.
2. **Green tests aren't working software.** Done means a real browser flow passes, tied to a spec number.
3. **Rewire before rebuild.** Audit what's there first.
4. **Try it as a stranger.** A fresh clone on an empty database found four real bugs in a day.
5. **Write the failure down in the repo.** `specs/OVERHAUL.md` stays public.

## 9. What's next

- Connect a real Google account and a real hosted Supabase.
- Publish the MCP to npm.
- Use it as the calendar base in other builds.

## 10. Sources

- Commits: `git log` of `fidgetcoding/meowlendar`.
- Specs: `specs/OVERHAUL.md`, `specs/PRODUCT.md`, `specs/TECH.md`, `DEPLOY.md`, `SECURITY.md`.
- Migration: `supabase/migrations/015_security_hardening.sql`.
- Private, kept by me: content note dated June 12, project notes dated July 3 and July 25. Setup and safety reports, November 1, 2026 (session notes).
