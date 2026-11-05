# Meowlendar: the essence

**What it is.** A calendar and task app you host yourself, with a real REST API and a 63-tool MCP server, so your AI agent can put a task straight on your calendar grid. Next.js, Supabase, MIT.

**Who it's for.** People who live with an AI agent and want it to run their calendar. Anyone sick of paying monthly for calendar software. Builders who need a calendar base to start from.

**Why it exists.** I hate paying for tools. Motion claimed to be a smart calendar and had no usable API at the time. Morgen was too expensive and lacking, and tasks made through its API landed in the inbox instead of on the calendar. I wanted tasks plus calendar, unlimited calendars, a link to my 2ndBrain, and $0. The cat name is for the brainrot and the meme value. I use it as the base for anything I build that needs a calendar.

**What's different.**
- API-scheduled tasks land on the grid with no drag.
- Works with no Google account. Every account starts with a local calendar.
- With Google, one consent screen signs you in and connects your calendars, and the first sync starts by itself.
- You own all of it. **I don't host a database for anyone.** You set up your own Supabase, and your own Google Cloud login if you want Google. The README walks you, or your agent, through both.
- The MCP covers the app, 63 tools on one key.
- It syncs with an Obsidian vault both ways, with a dry run and a backup first.
- The repo documents its own failure: `specs/OVERHAUL.md` explains how 1,255 passing tests sat on top of an app where nothing worked.

**How to try it.** Needs Node 22+, pnpm, the Supabase CLI and Docker.

```bash
git clone https://github.com/fidgetcoding/meowlendar && cd meowlendar
pnpm install && pnpm setup:local && pnpm dev
```

Open `http://localhost:3000`, click Sign up, and use any email. Or paste the block in the [README](README.md) into your agent and let it do the setup. Google is optional, and the README has its own steps for it.

**What works today.** From CI on the latest commit (`72f1fff`, November 5, 2026) and the runs logged in [EVOLUTION.md](EVOLUTION.md):

- 1,664 unit tests, lint and types clean.
- 150 integration tests on a real local Supabase and a production build. Google, Telegram, Resend and push are local fakes in these.
- 25 browser tests on the same stack, including a check that the grid scrolls through the whole day. One needed a retry on that run.
- The packed MCP starts from a clean npm cache and lists 63 tools.
- My own Google account on a local install, November 5: one consent screen, then 3 calendars and 30 events pulled in. Real Google writes haven't been tested yet.
- Two people booking overlapping slots on different links from the same owner: only one wins, proven with real concurrent transactions on a local database (November 4).
- Lists page through everything. Fixtures of 1,207 tasks, 1,207 events and 1,207 routine states come back whole.
- Recurring events expand faster: median 876.84 ms before and 138.61 ms after, on 2,100 occurrences. That's about 84% less time on one benchmark, not a whole-app speed claim.
- Cross-user attacks that worked before the November 1 security pass are refused after it.
- The 2ndBrain link, tested on temp vaults.
