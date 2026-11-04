# Meowlendar, on one page

**What it is.** A self-hosted calendar and task app with a real API and a 63-tool MCP server, so an AI agent can put a task straight on your calendar grid. Next.js, Supabase, MIT.

**Who it's for.** People who live with an AI agent and want it to run their calendar. Anyone sick of paying monthly for calendar software. Builders who need a calendar base to start from.

**Why it exists.** I hate paying for tools. Motion claimed to be a smart calendar and had no usable API at the time. Morgen was too expensive and lacking, and tasks made through its API landed in the inbox instead of on the calendar. I wanted tasks plus calendar, unlimited calendars, a link to my 2ndBrain, and $0. The cat name is for the brainrot and the meme value. I use it as the base for anything I build that needs a calendar.

**What's different.**
- API-scheduled tasks land on the grid with no drag.
- Works with no Google account. Every account starts with a local calendar.
- You own all of it. **I don't host a database for anyone.** You set up your own Supabase.
- The MCP covers the app, 63 tools on one key.
- It syncs with an Obsidian vault both ways, with a dry run and a backup first.
- The repo documents its own failure: `specs/OVERHAUL.md` explains how 1,255 passing tests sat on top of an app where nothing worked.

**How to try it.** Needs Node 22+, pnpm, the Supabase CLI and Docker. `git clone https://github.com/fidgetcoding/meowlendar && cd meowlendar && pnpm install && pnpm setup:local && pnpm dev`. Or paste the block in the README into your agent.

## What works today

From a fresh run on an empty local database, November 2, 2026, and again in CI:

- 1,601 unit tests, 24 browser tests, lint clean.
- 137 integration tests on a real local Supabase and a production build. Google, Telegram, Resend and push are local fakes in these.
- Every MCP tool called against the real stack.
- Local calendars, recurring events, routines, booking pages, subdomain booking on `localhost`.
- Automatic sync, all calendars with a picker, tasks mirrored to Google: proven against the fake Google.
- The 2ndBrain link, on temp vaults.
- The MCP tarball, installed and run from an empty npm cache.
- Cross-user attacks that worked before the security pass are refused after it.

See [EVOLUTION.md](EVOLUTION.md) for how it got here.


Local maintenance verification, November 4, 2026: 1,643 unit tests, 150 real local-database integration tests, 24 browser checks, build/lint/types passed. This review branch adds atomic booking/task/recurrence writes, sync-race protection, complete database paging and timezone fixes. Nothing has been deployed or pushed; the November 2 history above remains the evidence for the earlier packaging checks. See [EVOLUTION.md](EVOLUTION.md).
