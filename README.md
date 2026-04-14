# session-report

A command-line tool that aggregates AI coding assistant session histories — **Claude Code**, **Codex CLI**, and **Cursor** — normalizes them into a unified format, and exports them to **PDF** or **DOCX** documents.

## Features

- Discovers sessions from Claude Code (`~/.claude`), Codex CLI (`~/.codex`), and Cursor (`~/.cursor`)
- Normalizes all formats into a unified schema
- Exports to PDF (via Playwright/Chromium) or DOCX (via `docx`)
- Filters by provider, repository, worktree, date range, or session ID
- Export modes: single file per session, combined, split by provider, split by repo
- Detects Git context (repo root, branch, worktree)
- Local-only — no external API calls, no data uploaded

## Installation

```bash
npm install
npm run build
```

After building, link the CLI globally:

```bash
npm link
```

Or run directly:

```bash
node dist/index.cjs <command>
```

## Usage

### Scan — overview of detected sessions

```bash
session-report scan
session-report scan --provider claude
session-report scan --since 2026-01-01 --json
```

### List — browse sessions with filters

```bash
session-report list
session-report list --provider claude --repo myproject
session-report list --since 2026-04-01 --limit 20
session-report list --worktree
session-report list --no-housekeeping
```

### Export — generate PDF or DOCX

```bash
# Combined PDF of all Claude sessions
session-report export --provider claude --format pdf --mode combined

# One DOCX per session
session-report export --format docx --mode single --output ./out

# Split by repository (one PDF per repo)
session-report export --format pdf --mode split-repo --output ./reports

# Export a single session by ID
session-report export --session abc123 --format pdf

# Include tool calls and timestamps
session-report export --include-tool-calls --include-timestamps --format pdf

# Filter by date range
session-report export --since 2026-04-01 --until 2026-04-14 --format pdf
```

## CLI Flags

### Global

| Flag | Description |
|---|---|
| `--claude-root <path>` | Override `~/.claude` directory |
| `--codex-root <path>` | Override `~/.codex` directory |
| `--cursor-root <path>` | Override `~/.cursor` directory |

### Filter Flags (available on `list` and `export`)

| Flag | Description |
|---|---|
| `-p, --provider <provider...>` | Filter by provider: `claude`, `codex`, `cursor` |
| `--repo <name>` | Substring match on git repository name |
| `--worktree` | Only include worktree sessions |
| `--session <id>` | Filter by session ID prefix |
| `--since <date>` | Only sessions after this ISO date |
| `--until <date>` | Only sessions before this ISO date |
| `--no-housekeeping` | Exclude sessions with no assistant output |

### Export Flags

| Flag | Description |
|---|---|
| `--format <format>` | `pdf` (default) or `docx` |
| `--mode <mode>` | `combined` (default), `single`, `split-provider`, `split-repo` |
| `--output <dir>` | Output directory (default: `./session-reports`) |
| `--include-tool-calls` | Include tool call/result events |
| `--include-meta` | Include system/meta events |
| `--include-thinking` | Include thinking blocks |
| `--include-timestamps` | Prefix events with timestamps |
| `--max-tool-lines <n>` | Max lines of tool output (default: 50) |

## Architecture

```
Raw Session Files
  ↓
Provider Adapters (claude.ts / codex.ts / cursor.ts)
  ↓ scanFile() — lightweight metadata
  ↓ parseFile() — full event extraction
  ↓
Normalization Layer (normalize.ts)
  ↓ EventKind normalization
  ↓ Title extraction
  ↓ Git context detection (git.ts)
  ↓
Markdown Renderer (render/markdown.ts)
  ↓
Export Layer
  ├── PDF (export/pdf.ts) — Playwright + marked + highlight.js
  └── DOCX (export/docx.ts) — docx library
```

## Session Storage Locations

| Provider | Location |
|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` |
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` |
| Cursor (JSONL) | `~/.cursor/projects/*/agent-transcripts/**/*.jsonl` |
| Cursor (SQLite) | `~/.cursor/chats/**/store.db` |

## Requirements

- Node.js >= 20
- Playwright Chromium (installed automatically via `postinstall`)

## Development

```bash
# Run in dev mode (no build needed)
npm run dev -- scan

# Type check
npm run typecheck

# Run tests
npm test

# Build
npm run build
```

## License

MIT
