# session-report

A CLI tool that exports AI coding assistant sessions from **Claude Code**, **Codex CLI**, and **Cursor** into **PDF** or **DOCX** documents.

## Installation

### npm (recommended)

```bash
npm install -g session-report
```

### npx (no install required)

```bash
npx session-report scan
```

### Homebrew

```bash
brew tap Adyasha8105/session-report https://github.com/Adyasha8105/session-report
brew install Adyasha8105/session-report/session-report
```

> For PDF export, run `npx playwright install chromium` after installing.
> DOCX export works immediately with no extra steps.

## Commands

### `scan`

Show a summary of all detected sessions grouped by provider.

```bash
session-report scan
session-report scan --provider claude
session-report scan --since 2026-01-01
session-report scan --json
```

### `list`

Browse sessions with filters.

```bash
session-report list
session-report list --provider claude --repo myproject
session-report list --since 2026-04-01 --limit 20
session-report list --worktree
session-report list --no-housekeeping
```

### `export`

Export sessions to PDF or DOCX.

```bash
# Combined PDF of all sessions
session-report export --format pdf

# One file per session
session-report export --format docx --mode single --output ./out

# Split by repository
session-report export --format pdf --mode split-repo

# Export a specific session
session-report export --session abc123 --format pdf

# Filter by provider and date range
session-report export --provider claude --since 2026-04-01 --format pdf

# Include tool calls and timestamps
session-report export --include-tool-calls --include-timestamps --format pdf
```

## Flags

### Filter flags (available on `list` and `export`)

| Flag | Description |
|---|---|
| `-p, --provider <provider...>` | Filter by provider: `claude`, `codex`, `cursor` |
| `--repo <name>` | Substring match on git repository name |
| `--worktree` | Only include worktree sessions |
| `--session <id>` | Filter by session ID prefix |
| `--since <date>` | Only sessions after this ISO date |
| `--until <date>` | Only sessions before this ISO date |
| `--no-housekeeping` | Exclude sessions with no assistant output |

### Export flags

| Flag | Description |
|---|---|
| `--format <format>` | `pdf` (default) or `docx` |
| `--mode <mode>` | `combined` (default), `single`, `split-provider`, `split-repo` |
| `--output <dir>` | Output directory (default: `./session-reports`) |
| `--include-tool-calls` | Include tool call/result events |
| `--include-meta` | Include system/meta events |
| `--include-thinking` | Include thinking blocks |
| `--include-timestamps` | Prefix each event with its timestamp |
| `--max-tool-lines <n>` | Max lines of tool output to include (default: `50`) |

### Global flags

| Flag | Description |
|---|---|
| `--claude-root <path>` | Override `~/.claude` directory |
| `--codex-root <path>` | Override `~/.codex` directory |
| `--cursor-root <path>` | Override `~/.cursor` directory |

## Session storage locations

| Provider | Location |
|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` |
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` |
| Cursor (JSONL) | `~/.cursor/projects/*/agent-transcripts/**/*.jsonl` |
| Cursor (SQLite) | `~/.cursor/chats/**/store.db` |

## How it works

```
Session files on disk
  ↓
Provider adapters (Claude / Codex / Cursor)
  ↓ scanFile()  - fast metadata read
  ↓ parseFile() - full event extraction
  ↓
Normalize events (roles, kinds, titles, git context)
  ↓
Render to Markdown
  ↓
Export
  ├── PDF  - Playwright + marked + highlight.js
  └── DOCX - docx library
```

## Development

```bash
git clone https://github.com/Adyasha8105/session-report.git
cd session-report
npm install
npm run dev -- scan     # run without building
npm run typecheck       # type check
npm test                # run tests
npm run build           # build to dist/
```

## Requirements

- Node.js >= 20
- Playwright Chromium for PDF export (`npx playwright install chromium`)

## License

MIT
