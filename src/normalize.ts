import type { EventKind, Session, SessionEvent } from './schema.js';

/**
 * Map raw type/role strings from any provider to a normalized EventKind.
 * Mirrors the Swift SessionEventKind.from(role:type:) implementation.
 */
export function normalizeEventKind(type?: string, role?: string): EventKind {
  const t = type?.toLowerCase().trim();
  const r = role?.toLowerCase().trim();

  if (t) {
    if (['tool_call', 'tool_use', 'function_call', 'tool-call', 'web_search_call'].includes(t))
      return 'tool_call';
    if (['tool_result', 'function_result', 'tool_result_block'].includes(t))
      return 'tool_result';
    if (t === 'error' || t === 'err')
      return 'error';
    if (['system', 'summary', 'meta', 'queue-operation', 'inject-context',
         'env_context', 'file-history-snapshot'].includes(t))
      return 'meta';
    if (t === 'user' || t === 'human')
      return 'user';
    if (['assistant', 'model', 'gemini', 'ai'].includes(t))
      return 'assistant';
  }

  if (r) {
    if (r === 'user' || r === 'human') return 'user';
    if (['assistant', 'model', 'ai'].includes(r)) return 'assistant';
    if (r === 'tool') return 'tool_result';
    if (r === 'system') return 'meta';
  }

  return 'meta';
}

/**
 * Extract the title from a session's events.
 * Uses the first non-meta, non-empty user message text (up to 120 chars).
 */
export function extractTitle(events: SessionEvent[]): string | null {
  for (const ev of events) {
    if (ev.kind === 'user' && ev.text) {
      // Strip XML tags like <user_query>...</user_query>, <cwd>, etc.
      const stripped = ev.text.replace(/<[^>]+>/g, '').trim();
      if (stripped.length > 0) {
        return stripped.slice(0, 120);
      }
    }
  }
  return null;
}

/**
 * A session is "housekeeping" if it has no real assistant output —
 * e.g. only meta/system events, no actual assistant text responses.
 */
export function isHousekeepingSession(events: SessionEvent[]): boolean {
  return !events.some((e) => e.kind === 'assistant' && e.text && e.text.trim().length > 0);
}

/**
 * Coalesce consecutive assistant events sharing the same messageId
 * into a single event. Prevents streaming chunk fragmentation in output.
 */
export function coalesceEvents(events: SessionEvent[]): SessionEvent[] {
  const result: SessionEvent[] = [];
  let pending: SessionEvent | null = null;

  for (const ev of events) {
    if (
      ev.kind === 'assistant' &&
      ev.messageId &&
      pending &&
      pending.kind === 'assistant' &&
      pending.messageId === ev.messageId
    ) {
      // Merge text into pending
      pending = {
        ...pending,
        text: [pending.text, ev.text].filter(Boolean).join(''),
        isDelta: false,
      };
    } else {
      if (pending) result.push(pending);
      pending = ev;
    }
  }

  if (pending) result.push(pending);
  return result;
}

/** Apply filter options to a list of sessions. */
export function filterSessions(
  sessions: Session[],
  opts: {
    provider?: string[];
    repo?: string;
    worktree?: boolean;
    session?: string;
    since?: Date;
    until?: Date;
    noHousekeeping?: boolean;
  }
): Session[] {
  return sessions.filter((s) => {
    if (opts.provider && opts.provider.length > 0) {
      if (!opts.provider.includes(s.provider)) return false;
    }
    if (opts.repo) {
      const name = s.git?.repoName ?? '';
      if (!name.toLowerCase().includes(opts.repo.toLowerCase())) return false;
    }
    if (opts.worktree) {
      if (!s.git?.isWorktree) return false;
    }
    if (opts.session) {
      if (!s.id.startsWith(opts.session)) return false;
    }
    if (opts.since) {
      const t = s.startTime ?? s.endTime;
      if (!t || t < opts.since) return false;
    }
    if (opts.until) {
      const t = s.startTime ?? s.endTime;
      if (!t || t > opts.until) return false;
    }
    if (opts.noHousekeeping) {
      if (s.isHousekeeping) return false;
    }
    return true;
  });
}
