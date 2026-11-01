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

## 2ndBrain link

Two-way sync between Obsidian Tasks lines in a folder of your vault and your Meowlendar tasks. A hosted app can't reach files on your machine, so this part runs locally: a second command, `meowlendar-vault`, and three MCP tools. Both talk to the app over the REST API with the same `MEOWLENDAR_API_KEY` and `MEOWLENDAR_API_URL`.

It works on any Obsidian vault using the Obsidian Tasks plugin format.

```bash
meowlendar-vault connect --name work --vault ~/Notes --folder Tasks
meowlendar-vault plan --name work
meowlendar-vault apply --name work --plan <id from the plan>
```

| Command | What it does |
| --- | --- |
| `connect --name --vault --folder` | Validates the paths and saves them in `$MEOWLENDAR_CONFIG_DIR/vaults.json` (default `~/.config/meowlendar/vaults.json`, mode 600). One connection per vault. |
| `list` | Shows connected vaults. |
| `disconnect --name` | Forgets the connection. The vault and the app stay as they are. |
| `plan --name [--json]` | The dry run. Prints every change and a plan ID. |
| `apply --name --plan <id>` | Applies exactly that plan. There is no way to apply without an ID. |

Pass `--no-import-app-tasks` to `connect` to keep app tasks out of that vault for good, or to both `plan` and `apply` for one run.

The MCP tools are `vault_list`, `vault_plan` (`name`) and `vault_apply` (`name`, `plan_id`). They take a vault name, never a path, and there is no connect tool. I built it that way so text an agent reads can't aim the sync at another folder: connecting a vault is something you do in a terminal.

### What syncs

```
- [ ] text ⏫ 📅 2026-04-15 ⏳ 2026-04-14 🛫 2026-04-13 🔁 every week ✅ 2026-04-16 🆔 abc123
```

| On the line | In the app |
| --- | --- |
| The text | `title` |
| `[ ]` | `status` backlog |
| `[/]` | `status` in_progress. The app's `check` column also shows as `[/]`. |
| `[x]` or `[X]` | `status` done |
| `✅` date | `completed_at` |
| `📅` date | `due_date` |
| 🔺 ⏫ 🔼 🔽 ⏬ | `importance` highest, high, normal, low, lowest. No emoji reads as normal. |
| `🆔` | `vault_ref`, as `<vault name>:<id>` |

`⏳`, `🛫`, `🔁` and tags stay in the vault only. A line's existing `🆔` is kept byte for byte, whatever its format. A line without one gets `🆔 mw-<8 hex>` on its first apply. Only the fields that changed get rewritten, so everything else on a line keeps its exact bytes, and lines that aren't tasks or that sit in a code fence or frontmatter are never touched.

Fields count where the Obsidian Tasks plugin reads them, at the end of the line. In `Pay 📅 2026-01-01 rent`, the date is part of the text.

### Conflict rule

If both sides changed the same field since the last sync, the vault wins, and the app value that lost is listed in the plan under `conflicts`. A field changed on only one side flows to the other. The state file `<vault>/.meowlendar/sync-state.json` holds what each side looked like at the last sync, which is how it can tell.

### What a dry run shows

`plan` writes nothing to the vault or the app. It shows the line changes (before and after), the app changes, the conflicts and the value each one loses, lines removed from the vault, tasks deleted in the app, and anything it skipped and why. The plan ID is a hash of the plan and of every file it read. `apply` works the plan out again and refuses if the ID no longer matches, so a change on either side since the dry run means you plan again.

### New and deleted on either side

- A new line creates a task.
- A new app task is added to `<folder>/Meowlendar.md`, created if needed.
- A line removed from the vault, or marked `[-]` by you: the task stays in the app and loses its link. It won't be imported back.
- A task deleted in the app: its line gets `[-]` and `❌ <date>`. It won't be created again.

Nothing deletes a line or a task. If every task a vault tracks disappears at once (five or more), the plan stops, since that usually means an API key from another account.

### Backups and safety

- Before any write, every file about to change and the state file are copied to `<vault>/.meowlendar/backups/<timestamp>/<same relative path>`. If that fails, nothing is written. Old backups are not pruned.
- Writes go through a temp file in the same directory, then a rename.
- Each file's hash is checked again right before its write. A file edited since the plan is left alone, along with anything that depended on it. Run `plan` again to pick it up.
- The vault needs a `.obsidian` directory. The folder has to be inside it, and can't use `..`, be absolute, or sit in `.obsidian`, `.meowlendar`, or `.git`. Only `.md` files are read. Symlinks that lead out of the vault are skipped and reported.
- If the app fails partway, `apply` stops calling it and reports where. The next `plan` and `apply` pick up from there without duplicates.

The app allows 100 writes per minute for one API key. A first sync bigger than that stops at the limit, and you run `plan` and `apply` again a minute later to continue.

These lines get reported and skipped, never changed: an id on more than one line, an id the app can't store (over the length limit or with other characters), a status other than `[ ]`, `[/]`, `[x]`, `[X]` or `[-]`, no task text, an impossible date.

## Development

```bash
pnpm dev     # run from source with tsx
pnpm build   # bundle to dist/index.js and dist/vault-cli.js with tsup
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
