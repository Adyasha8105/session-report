# session-report

Hit a rate limit? Switch tools without losing context.
Need to share your work? Export everything into one document.

`session-report` reads your AI coding sessions from **Claude Code**, **Codex CLI**, **Cursor**, **Gemini CLI**, **OpenCode**, and **GitHub Copilot** and exports them as Markdown, JSON, PDF, or DOCX — across any number of sessions, tools, or Git worktrees.

## What it solves

**Switching tools mid-build**
Hit Claude's rate limit? Run `session-report copy` and paste directly into Codex, Cursor, or any other AI tool. Full context, zero re-explaining.

**Sharing your work**
Need to submit or review what you built with AI? One command generates a clean, readable document of everything — regardless of which tools you used.

## Quickstart

```bash
npm install -g session-report
session-report export               # exports as Markdown (default)
session-report export --format json # exports as JSON
session-report export --format pdf  # exports as PDF
```

## Installation

### npm

```bash
npm install -g session-report
```

### npx (no install)

```bash
npx session-report export               # Markdown
npx session-report export --format pdf  # PDF
```


## Usage

### Check what sessions are on your machine

```bash
session-report scan
session-report list
```

### Copy session context to clipboard (for switching AI tools)

```bash
session-report copy                        # copy most recent session
session-report copy --last 3               # copy last 3 sessions
session-report copy --provider claude      # copy most recent Claude session
session-report copy --session abc123       # copy a specific session
```

The copied text is ready to paste directly into Claude, ChatGPT, Gemini, or any other AI tool.

### Export everything into one document

```bash
session-report export                          # Markdown (default)
session-report export --format json            # JSON
session-report export --format pdf             # PDF
session-report export --format docx            # DOCX
session-report export --output ./output        # custom output dir
```

### Export sessions from a specific project or worktree

```bash
session-report export --repo my-project
session-report export --worktree
```

### Export from a specific tool

```bash
session-report export --provider claude
session-report export --provider codex  --format json
session-report export --provider gemini --format pdf
session-report export --provider opencode
session-report export --provider copilot --format docx
```

### One file per session

```bash
session-report export --mode single --output ./sessions
session-report export --mode single --format json --output ./sessions
```

### Filter by date

```bash
session-report export --since 2026-04-01
session-report export --since 2026-04-01 --format json
```

## Commands

| Command | Description |
|---|---|
| `scan` | Summary of all detected sessions by provider |
| `list` | Browse sessions with filters |
| `copy` | Copy session context to clipboard for pasting into another AI tool |
| `export` | Export sessions to Markdown, JSON, PDF, or DOCX |

## Flags

### Filter flags (`list` and `export`)

| Flag | Description |
|---|---|
| `-p, --provider <provider...>` | Filter by provider: `claude`, `codex`, `cursor`, `gemini`, `opencode`, `copilot` |
| `--repo <name>` | Substring match on repository name |
| `--worktree` | Only include worktree sessions |
| `--session <id>` | Filter by session ID prefix |
| `--since <date>` | Only sessions after this ISO date |
| `--until <date>` | Only sessions before this ISO date |
| `--no-housekeeping` | Exclude sessions with no assistant output |

### Copy flags

| Flag | Description |
|---|---|
| `--last <n>` | Number of most recent sessions to include (default: `1`) |
| `--max-chars <n>` | Truncate output to N characters, `0` = unlimited (default: `0`) |
| `--stdout` | Print to stdout instead of copying to clipboard |
| `--include-tool-calls` | Include tool call/result events |
| `--include-thinking` | Include thinking blocks |
| `--include-timestamps` | Prefix each event with its timestamp |

### Export flags

| Flag | Description |
|---|---|
| `--format <format>` | `md` (default), `json`, `docx`, or `pdf` |
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
| Gemini CLI | `~/.gemini/tmp/**/session-*.json` |
| OpenCode | `~/.local/share/opencode/storage/session/**/*.json` |
| GitHub Copilot | `~/.copilot/session-state/**/*.jsonl` |

## Requirements

- Node.js >= 20

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
