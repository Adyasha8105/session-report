import { statSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import fg from 'fast-glob';
import pLimit from 'p-limit';
import type { Session, Provider, FilterOptions } from './schema.js';
import type { DiscoveryError as IDiscoveryError } from './schema.js';
import { ClaudeAdapter } from './providers/claude.js';
import { CodexAdapter } from './providers/codex.js';
import { CursorAdapter } from './providers/cursor.js';
import { GeminiAdapter } from './providers/gemini.js';
import { OpenCodeAdapter } from './providers/opencode.js';
import { CopilotAdapter } from './providers/copilot.js';
import { detectGitContext } from './git.js';
import { filterSessions } from './normalize.js';
import { expandTilde } from './util/paths.js';

export interface DiscoveryConfig {
  providers?: Provider[];
  claudeRoot?: string;
  codexRoot?: string;
  cursorRoot?: string;
  cursorAppDataRoot?: string;
  geminiRoot?: string;
  openCodeRoot?: string;
  copilotRoot?: string;
  filter?: FilterOptions;
}

export interface DiscoveryResult {
  sessions: Session[];
  errors: IDiscoveryError[];
}

const SCAN_CONCURRENCY = 8;

/**
 * Returns the platform-specific Cursor app data directory (where workspaceStorage lives).
 * - macOS:   ~/Library/Application Support/Cursor
 * - Windows: %APPDATA%\Cursor
 * - Linux:   $XDG_CONFIG_HOME/Cursor or ~/.config/Cursor
 */
function getCursorAppDataPath(): string | null {
  const home = homedir();
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Cursor');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    return appData ? join(appData, 'Cursor') : null;
  }
  // Linux / other
  const xdg = process.env.XDG_CONFIG_HOME;
  return join(xdg ?? join(home, '.config'), 'Cursor');
}

const claudeAdapter = new ClaudeAdapter();
const codexAdapter = new CodexAdapter();
const cursorAdapter = new CursorAdapter();
const geminiAdapter = new GeminiAdapter();
const openCodeAdapter = new OpenCodeAdapter();
const copilotAdapter = new CopilotAdapter();

export async function discoverSessions(config: DiscoveryConfig = {}): Promise<DiscoveryResult> {
  const providers = config.providers ?? ['claude', 'codex', 'cursor', 'gemini', 'opencode', 'copilot'];
  const errors: IDiscoveryError[] = [];
  const allFiles: Array<{ filePath: string; provider: Provider }> = [];

  // ---- Discover files per provider ----
  const claudeRoot = expandTilde(config.claudeRoot ?? '~/.claude');
  const codexRoot = expandTilde(config.codexRoot ?? '~/.codex');
  const cursorRoot = expandTilde(config.cursorRoot ?? '~/.cursor');
  const cursorAppDataRoot = config.cursorAppDataRoot
    ? expandTilde(config.cursorAppDataRoot)
    : getCursorAppDataPath();
  const geminiRoot = expandTilde(config.geminiRoot ?? '~/.gemini');
  const openCodeRoot = expandTilde(config.openCodeRoot ?? '~/.local/share/opencode');
  const copilotRoot = expandTilde(config.copilotRoot ?? '~/.copilot');

  if (providers.includes('claude') && existsSync(claudeRoot)) {
    const patterns = [
      `${claudeRoot}/projects/**/*.jsonl`,
      `${claudeRoot}/projects/**/*.ndjson`,
    ];
    const files = await fg(patterns, { onlyFiles: true, absolute: true, suppressErrors: true });
    for (const f of files) {
      allFiles.push({ filePath: f, provider: 'claude' });
    }
  }

  if (providers.includes('codex') && existsSync(codexRoot)) {
    const patterns = [`${codexRoot}/sessions/**/rollout-*.jsonl`];
    const files = await fg(patterns, { onlyFiles: true, absolute: true, suppressErrors: true });
    for (const f of files) {
      allFiles.push({ filePath: f, provider: 'codex' });
    }
  }

  if (providers.includes('cursor')) {
    const cursorPatterns: string[] = [];
    if (existsSync(cursorRoot)) {
      cursorPatterns.push(
        `${cursorRoot}/projects/*/agent-transcripts/**/*.jsonl`,
        `${cursorRoot}/chats/**/store.db`,
      );
    }
    if (cursorAppDataRoot && existsSync(cursorAppDataRoot)) {
      // Normalize separators for fast-glob (important on Windows)
      const appDataGlob = cursorAppDataRoot.replace(/\\/g, '/');
      // globalStorage/state.vscdb holds the chat panel (Ctrl+L) history
      cursorPatterns.push(`${appDataGlob}/User/globalStorage/state.vscdb`);
    }
    if (cursorPatterns.length > 0) {
      const files = await fg(cursorPatterns, { onlyFiles: true, absolute: true, suppressErrors: true });
      for (const f of files) {
        allFiles.push({ filePath: f, provider: 'cursor' });
      }
    }
  }

  if (providers.includes('gemini') && existsSync(geminiRoot)) {
    const files = await fg([`${geminiRoot}/tmp/**/session-*.json`], { onlyFiles: true, absolute: true, suppressErrors: true });
    for (const f of files) allFiles.push({ filePath: f, provider: 'gemini' });
  }

  if (providers.includes('opencode') && existsSync(openCodeRoot)) {
    const files = await fg([`${openCodeRoot}/storage/session/**/*.json`], { onlyFiles: true, absolute: true, suppressErrors: true });
    for (const f of files) allFiles.push({ filePath: f, provider: 'opencode' });
  }

  if (providers.includes('copilot') && existsSync(copilotRoot)) {
    const files = await fg([
      `${copilotRoot}/session-state/**/events.jsonl`,
      `${copilotRoot}/session-state/*.jsonl`,
    ], { onlyFiles: true, absolute: true, suppressErrors: true });
    for (const f of files) allFiles.push({ filePath: f, provider: 'copilot' });
  }

  // Sort by file mtime descending (most recent first)
  const filesWithStat = allFiles
    .map(({ filePath, provider }) => {
      try {
        const mtime = statSync(filePath).mtimeMs;
        return { filePath, provider, mtime };
      } catch {
        return { filePath, provider, mtime: 0 };
      }
    })
    .sort((a, b) => b.mtime - a.mtime);

  // ---- Scan files (lightweight) ----
  const limit = pLimit(SCAN_CONCURRENCY);
  const sessions: Session[] = [];

  await Promise.all(
    filesWithStat.map(({ filePath, provider }) =>
      limit(async () => {
        try {
          let session: Session;
          if (provider === 'claude') {
            session = await claudeAdapter.scanFile(filePath);
          } else if (provider === 'codex') {
            session = await codexAdapter.scanFile(filePath);
          } else if (provider === 'gemini') {
            session = await geminiAdapter.scanFile(filePath);
          } else if (provider === 'opencode') {
            session = await openCodeAdapter.scanFile(filePath);
          } else if (provider === 'copilot') {
            session = await copilotAdapter.scanFile(filePath);
          } else {
            session = await cursorAdapter.scanFile(filePath);
          }

          // Enrich git context from cwd
          if (session.cwd) {
            session.git = detectGitContext(session.cwd);
          }

          sessions.push(session);
        } catch (err) {
          errors.push({
            filePath,
            provider,
            message: err instanceof Error ? err.message : String(err),
            cause: err instanceof Error ? err : undefined,
          });
        }
      })
    )
  );

  // Sort sessions by startTime descending
  sessions.sort((a, b) => {
    const ta = a.startTime?.getTime() ?? a.endTime?.getTime() ?? 0;
    const tb = b.startTime?.getTime() ?? b.endTime?.getTime() ?? 0;
    return tb - ta;
  });

  // Apply filters
  const filtered = config.filter
    ? filterSessions(sessions, config.filter)
    : sessions;

  return { sessions: filtered, errors };
}

/**
 * Fully parse a set of sessions (populate events array).
 * Uses a concurrency limit to avoid overwhelming the filesystem.
 */
export async function parseSessions(
  sessions: Session[],
  config: DiscoveryConfig = {}
): Promise<{ sessions: Session[]; errors: IDiscoveryError[] }> {
  const PARSE_CONCURRENCY = 4;
  const limit = pLimit(PARSE_CONCURRENCY);
  const results: Session[] = [];
  const errors: IDiscoveryError[] = [];

  await Promise.all(
    sessions.map((s) =>
      limit(async () => {
        try {
          let parsed: Session;
          if (s.provider === 'claude') {
            parsed = await claudeAdapter.parseFile(s.filePath);
          } else if (s.provider === 'codex') {
            parsed = await codexAdapter.parseFile(s.filePath);
          } else if (s.provider === 'gemini') {
            parsed = await geminiAdapter.parseFile(s.filePath);
          } else if (s.provider === 'opencode') {
            parsed = await openCodeAdapter.parseFile(s.filePath);
          } else if (s.provider === 'copilot') {
            parsed = await copilotAdapter.parseFile(s.filePath);
          } else {
            parsed = await cursorAdapter.parseFile(s.filePath);
          }

          // Carry over git context
          if (!parsed.git && s.git) {
            parsed.git = s.git;
          } else if (parsed.cwd && !parsed.git) {
            parsed.git = detectGitContext(parsed.cwd);
          }

          results.push(parsed);
        } catch (err) {
          errors.push({
            filePath: s.filePath,
            provider: s.provider,
            message: err instanceof Error ? err.message : String(err),
            cause: err instanceof Error ? err : undefined,
          });
        }
      })
    )
  );

  // Preserve original order
  const order = new Map(sessions.map((s, i) => [s.filePath, i]));
  results.sort((a, b) => (order.get(a.filePath) ?? 0) - (order.get(b.filePath) ?? 0));

  return { sessions: results, errors };
}
