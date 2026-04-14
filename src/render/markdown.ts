import type { Session, SessionEvent } from '../schema.js';
import { coalesceEvents } from '../normalize.js';
import { formatDate } from '../util/paths.js';

export interface MarkdownOptions {
  includeToolCalls: boolean;
  includeMetaEvents: boolean;
  includeThinking: boolean;
  includeTimestamps: boolean;
  maxToolOutputLines: number;
  maxMessageLines: number; // 0 = unlimited; truncates individual user/assistant messages
}

export const DEFAULT_MARKDOWN_OPTIONS: MarkdownOptions = {
  includeToolCalls: false,
  includeMetaEvents: false,
  includeThinking: false,
  includeTimestamps: false,
  maxToolOutputLines: 50,
  maxMessageLines: 0,
};

/** Convert a single Session to a Markdown string. */
export function sessionToMarkdown(session: Session, opts: MarkdownOptions = DEFAULT_MARKDOWN_OPTIONS): string {
  const lines: string[] = [];

  // ---- Header ----
  lines.push(`# ${escapeMarkdown(session.title ?? 'Untitled Session')}`);
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|---|---|');
  lines.push(`| Provider | ${session.provider} |`);
  lines.push(`| Session ID | \`${session.id.slice(0, 16)}\` |`);
  if (session.model) lines.push(`| Model | ${session.model} |`);
  if (session.git?.repoName) lines.push(`| Repository | ${session.git.repoName} |`);
  if (session.git?.branch) lines.push(`| Branch | \`${session.git.branch}\` |`);
  if (session.git?.isWorktree) lines.push(`| Worktree | yes |`);
  if (session.cwd) lines.push(`| Working Dir | \`${session.cwd}\` |`);
  if (session.startTime) lines.push(`| Started | ${session.startTime.toISOString()} |`);
  if (session.endTime) lines.push(`| Ended | ${session.endTime.toISOString()} |`);
  lines.push(`| Events | ${session.eventCount} |`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // ---- Events ----
  const events = coalesceEvents(session.events);

  for (const ev of events) {
    const rendered = renderEvent(ev, opts);
    if (rendered.length > 0) {
      lines.push(...rendered);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/** Generate a combined Markdown document from multiple sessions. */
export function sessionsToMarkdown(
  sessions: Session[],
  opts: MarkdownOptions = DEFAULT_MARKDOWN_OPTIONS
): string {
  const parts: string[] = [];

  // Cover page
  const now = new Date();
  parts.push('# Session Report');
  parts.push('');
  parts.push(`Generated: ${now.toISOString()}`);
  parts.push('');
  parts.push(`Sessions: ${sessions.length}`);
  const providers = [...new Set(sessions.map((s) => s.provider))].join(', ');
  parts.push(`Providers: ${providers}`);
  parts.push('');
  parts.push('---');
  parts.push('');

  // Table of contents
  parts.push('## Table of Contents');
  parts.push('');
  sessions.forEach((s, i) => {
    const title = s.title ?? 'Untitled Session';
    parts.push(`${i + 1}. ${escapeMarkdown(title)} *(${s.provider})*`);
  });
  parts.push('');
  parts.push('---');
  parts.push('');

  // Individual sessions
  for (const session of sessions) {
    parts.push(sessionToMarkdown(session, opts));
    parts.push('---');
    parts.push('');
  }

  return parts.join('\n');
}

// ---- Event rendering ----

function renderEvent(ev: SessionEvent, opts: MarkdownOptions): string[] {
  const lines: string[] = [];
  const tsPrefix = opts.includeTimestamps && ev.timestamp
    ? `*${ev.timestamp.toISOString()}* — `
    : '';

  switch (ev.kind) {
    case 'user':
      if (!ev.text) return [];
      lines.push(`#### User${tsPrefix ? '  ' + tsPrefix : ''}`);
      lines.push('');
      lines.push(truncateMessage(ev.text.trim(), opts.maxMessageLines));
      return lines;

    case 'assistant':
      if (!ev.text) return [];
      lines.push(`#### Assistant${tsPrefix ? '  ' + tsPrefix : ''}`);
      lines.push('');
      lines.push(truncateMessage(ev.text.trim(), opts.maxMessageLines));
      return lines;

    case 'tool_call':
      if (!opts.includeToolCalls) return [];
      lines.push(`### Tool Call: \`${ev.toolName ?? 'unknown'}\``);
      lines.push('');
      if (tsPrefix) lines.push(tsPrefix);
      if (ev.toolInput) {
        lines.push('```json');
        lines.push(prettyJson(ev.toolInput));
        lines.push('```');
      }
      return lines;

    case 'tool_result':
      if (!opts.includeToolCalls) return [];
      lines.push(`### Tool Result`);
      lines.push('');
      if (ev.toolOutput) {
        const truncated = truncateLines(ev.toolOutput, opts.maxToolOutputLines);
        lines.push('```');
        lines.push(truncated);
        lines.push('```');
      } else if (ev.text) {
        lines.push(ev.text);
      }
      return lines;

    case 'meta':
      if (!opts.includeMetaEvents) return [];
      if (ev.role === 'thinking' && !opts.includeThinking) return [];
      if (!ev.text) return [];
      lines.push('> **System**');
      lines.push('');
      lines.push(`> ${ev.text.replace(/\n/g, '\n> ')}`);
      return lines;

    case 'error':
      lines.push('> **Error**');
      lines.push('');
      if (ev.text) lines.push(`> ${ev.text}`);
      return lines;

    default:
      return [];
  }
}

function prettyJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function truncateLines(text: string, maxLines: number): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join('\n') + `\n... [${lines.length - maxLines} lines truncated]`;
}

function truncateMessage(text: string, maxLines: number): string {
  if (maxLines === 0) return text;
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join('\n') + `\n*… [${lines.length - maxLines} lines omitted]*`;
}

function escapeMarkdown(s: string): string {
  return s.replace(/[[\]`*_{}()#+\-.!]/g, '\\$&');
}
