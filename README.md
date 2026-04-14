# session-report

Hit a rate limit? Switch tools without losing context.
Need to share your work? Export everything into one document.

`session-report` reads your AI coding sessions from **Claude Code**, **Codex CLI**, and **Cursor** and exports them as PDF or DOCX — across any number of sessions, tools, or Git worktrees.

## What it solves

**Switching tools mid-build**
Hit Claude's rate limit? Export your session history and hand it to Codex or Cursor. Full context, zero re-explaining.

**Sharing your work**
Need to submit or review what you built with AI? One command generates a clean, readable document of everything — regardless of which tools you used.

## Quickstart

```bash
npm install -g session-report
session-report export --format pdf --output ./output
```

## Installation

### npm

```bash
npm install -g session-report
```

### npx (no install)

```bash
npx session-report export --format pdf
```

### Homebrew

```bash
brew tap Adyasha8105/session-report https://github.com/Adyasha8105/session-report
brew install Adyasha8105/session-report/session-report
```

> For PDF export, also run: `npx playwright install chromium`
> DOCX export works with no extra steps.

## Usage

### Check what sessions are on your machine

```bash
session-report scan
session-report list
```

### Export everything into one document

```bash
session-report export --format pdf --output ./output
```

### Export sessions from a specific project or worktree

```bash
session-report export --repo my-project --format pdf
session-report export --worktree --format pdf
```

### Export from a specific tool

```bash
session-report export --provider claude --format pdf
session-report export --provider codex --format docx
```

### One file per session

```bash
session-report export --mode single --format pdf --output ./sessions
```

### Filter by date

```bash
session-report export --since 2026-04-01 --format pdf
```

## Commands

| Command | Description |
|---|---|
| `scan` | Summary of all detected sessions by provider |
| `list` | Browse sessions with filters |
| `export` | Export sessions to PDF or DOCX |

## Flags

### Filter flags (`list` and `export`)

| Flag | Description |
|---|---|
| `-p, --provider <provider...>` | Filter by provider: `claude`, `codex`, `cursor` |
| `--repo <name>` | Substring match on repository name |
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

## Where sessions are read from

| Tool | Location |
|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` |
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` |
| Cursor | `~/.cursor/projects/*/agent-transcripts/**/*.jsonl` |
| Cursor (chat DB) | `~/.cursor/chats/**/store.db` |

## Requirements

- Node.js >= 20
- Playwright Chromium for PDF export (`npx playwright install chromium`)

## Development

```bash
git clone https://github.com/Adyasha8105/session-report.git
cd session-report
npm install
npm run dev -- scan
npm run typecheck
npm test
npm run build
```

## License

MIT
