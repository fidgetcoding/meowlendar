# meowlendar-mcp

An [MCP](https://modelcontextprotocol.io) server that gives Claude Code (and any
other MCP client) the same power over your calendar that the Meowlendar UI has —
events, tasks, routines, tags, and booking pages, all over one API key. Its
headline trick: `create_task` with `scheduled_start`/`scheduled_end` puts a task
straight onto the calendar grid instead of parking it in an inbox.

## Install

Create an API key in the app under **Settings > API Keys**, then register the server:

```bash
claude mcp add meowlendar -s user \
  --env MEOWLENDAR_API_KEY=pk_your_key_here \
  --env MEOWLENDAR_API_URL=http://localhost:3000 \
  -- npx -y meowlendar-mcp
```

Until the package is on npm, build it from your clone and run the file directly:

```bash
pnpm --filter meowlendar-mcp build
claude mcp add meowlendar -s user \
  --env MEOWLENDAR_API_KEY=pk_your_key_here \
  --env MEOWLENDAR_API_URL=http://localhost:3000 \
  -- node /absolute/path/to/meowlendar/packages/mcp/dist/index.js
```

| Variable             | Required | Default                 | What it is                                          |
| -------------------- | -------- | ----------------------- | --------------------------------------------------- |
| `MEOWLENDAR_API_KEY` | yes      | none                    | An API key from **Settings > API Keys** (`pk_...`). |
| `MEOWLENDAR_API_URL` | no       | `http://localhost:3000` | Base URL of your instance.                          |

The older `POOLENDAR_API_KEY` and `POOLENDAR_API_URL` names still work.

The server speaks stdio and exits immediately if no key is set. The app must be running for the tools to work.

## What it can do

The server wraps the Meowlendar REST API. A few highlights:

- **`create_task`** — create a task; pass `scheduled_start` + `scheduled_end` to
  drop it directly on the calendar grid (the killer feature).
- **`list_events`** — a date-range calendar read that returns events **and**
  scheduled tasks (and routine instances) in the window, each tagged with a
  `kind`.
- **`list_calendars`**: your local calendars, plus connected Google accounts and their sub-calendars.
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

## Publishing

`pnpm verify:mcp-pack` from the repo root packs the tarball npm would upload, then installs and runs it with an empty npm cache and home directory. To publish:

```bash
cd packages/mcp && pnpm publish --access public --no-git-checks
```
