# poolendar-mcp

An [MCP](https://modelcontextprotocol.io) server that gives Claude Code (and any
other MCP client) the same power over your calendar that the Poolendar UI has —
events, tasks, routines, tags, and booking pages, all over one API key. Its
headline trick: `create_task` with `scheduled_start`/`scheduled_end` puts a task
straight onto the calendar grid instead of parking it in an inbox.

## Install

The package is not published to npm, so build it from your clone:

```bash
pnpm --filter poolendar-mcp build
```

Create an API key in the app under **Settings > API Keys**, then register the
server, using the absolute path to your clone:

```bash
claude mcp add meowlendar -s user \
  --env POOLENDAR_API_KEY=pk_your_key_here \
  --env POOLENDAR_API_URL=http://localhost:3000 \
  -- node /absolute/path/to/meowlendar/packages/mcp/dist/index.js
```

| Variable            | Required | Default                 | What it is                                       |
| ------------------- | -------- | ----------------------- | ------------------------------------------------ |
| `POOLENDAR_API_KEY` | yes      | none                    | An API key from **Settings > API Keys** (`pk_...`). |
| `POOLENDAR_API_URL` | no       | `http://localhost:3000` | Base URL of your instance.                       |

The server speaks stdio and exits immediately if `POOLENDAR_API_KEY` is missing.
The app must be running for the tools to work. `create_event` needs a calendar,
and calendars come from a connected Google account. `create_task` works without one.

## What it can do

The server wraps the Poolendar REST API. A few highlights:

- **`create_task`** — create a task; pass `scheduled_start` + `scheduled_end` to
  drop it directly on the calendar grid (the killer feature).
- **`list_events`** — a date-range calendar read that returns events **and**
  scheduled tasks (and routine instances) in the window, each tagged with a
  `kind`.
- **`list_calendars`** — connected Google accounts and their sub-calendars.
- **`reflow_day`** — repack a day's flexible tasks so they stop overlapping.
- Full CRUD for events, tasks, subtasks, routines, tags, and booking links, plus
  type conversion and full-text search.

## Development

```bash
pnpm dev     # run from source with tsx
pnpm build   # bundle to a single dist/index.js with tsup
pnpm test    # vitest
```

The build inlines the `@poolendar/*` workspace packages so the published tarball
has no unresolvable `workspace:*` dependencies — only `@modelcontextprotocol/sdk`
is installed at runtime.
