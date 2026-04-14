import { statSync } from 'fs';
import { basename } from 'path';
import { createHash } from 'crypto';
import type { ProviderAdapter } from './base.js';
import type { Session, SessionEvent, EventKind } from '../schema.js';
import { readJsonlFile } from '../util/jsonl.js';
import { capBytes, redactBase64Images } from '../util/paths.js';
import { normalizeEventKind, extractTitle, isHousekeepingSession } from '../normalize.js';
import { ParseError } from '../util/errors.js';

const RAW_JSON_CAP = 8192;

// ---- Raw record shapes for Codex CLI JSONL ----

interface CodexToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface CodexContentBlock {
  type?: string;
  text?: string;
  image_url?: { url?: string };
}

interface CodexRawRecord {
  type?: string;
  role?: string;
  timestamp?: string | number;
  cwd?: string;
  git_branch?: string;
  model?: string;
  text?: string;
  content?: CodexContentBlock[] | string;
  // Tool-related
  tool_calls?: CodexToolCall[];
  tool_call_id?: string;
  function?: { name?: string; arguments?: string };
  // Streaming
  delta?: boolean;
  delta_index?: number;
  // Message threading
  id?: string;
  parent_id?: string;
  // Git metadata
  git?: { branch?: string; commit_hash?: string };
}

export class CodexAdapter implements ProviderAdapter {
  readonly provider = 'codex' as const;

  async scanFile(filePath: string): Promise<Session> {
    try {
      const stat = statSync(filePath);
      const { sessionId, startTime } = parseCodexFilename(basename(filePath));
      let cwd: string | null = null;
      let gitBranch: string | null = null;
      let model: string | null = null;
      let firstUserText: string | null = null;

      for await (const raw of readJsonlFile(filePath, { maxLines: 50 })) {
        const rec = raw as CodexRawRecord;
        if (!cwd && rec.cwd) cwd = rec.cwd;
        if (!gitBranch && rec.git_branch) gitBranch = rec.git_branch;
        if (!gitBranch && rec.git?.branch) gitBranch = rec.git.branch;
        if (!model && rec.model) model = rec.model;
        if (!firstUserText) {
          const kind = normalizeEventKind(rec.type, rec.role);
          if (kind === 'user') {
            firstUserText = extractCodexText(rec);
          }
        }
      }

      return {
        id: sessionId,
        provider: 'codex',
        filePath,
        title: firstUserText ? firstUserText.slice(0, 120) : null,
        model,
        startTime,
        endTime: new Date(stat.mtimeMs),
        cwd,
        git: null,
        events: [],
        eventCount: Math.round(stat.size / 150),
        fileSizeBytes: stat.size,
        isHousekeeping: false,
        isFullyParsed: false,
      };
    } catch (err) {
      throw new ParseError(filePath, 'codex', err instanceof Error ? err : undefined);
    }
  }

  async parseFile(filePath: string): Promise<Session> {
    try {
      const stat = statSync(filePath);
      const { sessionId, startTime } = parseCodexFilename(basename(filePath));
      const events: SessionEvent[] = [];
      let cwd: string | null = null;
      let gitBranch: string | null = null;
      let model: string | null = null;

      // Map tool_call_id → toolName so tool results can reference their tool name
      const toolNameMap = new Map<string, string>();

      for await (const raw of readJsonlFile(filePath)) {
        const rec = raw as CodexRawRecord;
        if (!cwd && rec.cwd) cwd = rec.cwd;
        if (!gitBranch && rec.git_branch) gitBranch = rec.git_branch;
        if (!gitBranch && rec.git?.branch) gitBranch = rec.git.branch;
        if (!model && rec.model) model = rec.model;

        // Register tool call ids before parsing so tool results can look them up
        if (rec.tool_calls) {
          for (const tc of rec.tool_calls) {
            if (tc.id && tc.function?.name) toolNameMap.set(tc.id, tc.function.name);
          }
        }

        const evs = parseCodexRecord(rec, toolNameMap);
        events.push(...evs);
      }

      return {
        id: sessionId,
        provider: 'codex',
        filePath,
        title: extractTitle(events),
        model,
        startTime,
        endTime: new Date(stat.mtimeMs),
        cwd,
        git: null,
        events,
        eventCount: events.filter((e) => e.kind !== 'meta').length,
        fileSizeBytes: stat.size,
        isHousekeeping: isHousekeepingSession(events),
        isFullyParsed: true,
      };
    } catch (err) {
      throw new ParseError(filePath, 'codex', err instanceof Error ? err : undefined);
    }
  }
}

// ---- Internal helpers ----

/**
 * Parse session ID and start time from Codex filename.
 * Pattern: rollout-YYYY-MM-DDTHH-mm-ss-<uuid>.jsonl
 */
function parseCodexFilename(filename: string): { sessionId: string; startTime: Date | null } {
  const match = filename.match(/^rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-([a-f0-9-]+)\.jsonl$/i);
  if (match) {
    const tsPart = match[1]!.replace(/T(\d{2})-(\d{2})-(\d{2})$/, 'T$1:$2:$3');
    const sessionId = match[2]!;
    const startTime = new Date(tsPart);
    return { sessionId, startTime: isNaN(startTime.getTime()) ? null : startTime };
  }
  // Fallback
  return {
    sessionId: createHash('sha1').update(filename).digest('hex').slice(0, 16),
    startTime: null,
  };
}

function parseCodexRecord(rec: CodexRawRecord, toolNameMap?: Map<string, string>): SessionEvent[] {
  const events: SessionEvent[] = [];
  const ts = rec.timestamp ? safeDate(rec.timestamp) : null;
  const raw = capBytes(JSON.stringify(rec), RAW_JSON_CAP);

  const kind = normalizeEventKind(rec.type, rec.role);

  // Tool calls embedded in assistant message
  if (rec.tool_calls && Array.isArray(rec.tool_calls) && rec.tool_calls.length > 0) {
    // First emit assistant text if any
    const text = extractCodexText(rec);
    if (text) {
      events.push(makeEvent({
        id: rec.id ?? generateId(raw + 'text'),
        kind: 'assistant',
        timestamp: ts,
        role: 'assistant',
        text,
        messageId: rec.id ?? null,
        parentId: rec.parent_id ?? null,
        isDelta: rec.delta === true,
        rawJson: null,
      }));
    }
    // Emit each tool call
    for (const tc of rec.tool_calls) {
      events.push(makeEvent({
        id: tc.id ?? generateId(raw + (tc.function?.name ?? '')),
        kind: 'tool_call',
        timestamp: ts,
        role: 'assistant',
        text: null,
        toolName: tc.function?.name ?? null,
        toolInput: tc.function?.arguments
          ? capBytes(tc.function.arguments, RAW_JSON_CAP)
          : null,
        messageId: rec.id ?? null,
        parentId: rec.parent_id ?? null,
        isDelta: false,
        rawJson: null,
      }));
    }
    return events;
  }

  // Tool result record
  if (rec.tool_call_id) {
    const text = extractCodexText(rec);
    const resolvedToolName = rec.function?.name ?? toolNameMap?.get(rec.tool_call_id) ?? null;
    events.push(makeEvent({
      id: generateId(rec.tool_call_id + raw),
      kind: 'tool_result',
      timestamp: ts,
      role: 'tool',
      text: null,
      toolName: resolvedToolName,
      toolOutput: text ? capBytes(redactBase64Images(text), RAW_JSON_CAP) : null,
      messageId: rec.id ?? null,
      parentId: rec.parent_id ?? null,
      isDelta: false,
      rawJson: null,
    }));
    return events;
  }

  // Standard message
  const text = extractCodexText(rec);
  if (kind === 'meta' && !text) return [];

  events.push(makeEvent({
    id: rec.id ?? generateId(raw),
    kind,
    timestamp: ts,
    role: rec.role ?? rec.type ?? null,
    text,
    messageId: rec.id ?? null,
    parentId: rec.parent_id ?? null,
    isDelta: rec.delta === true,
    rawJson: raw,
  }));

  return events;
}

function extractCodexText(rec: CodexRawRecord): string | null {
  if (rec.text) return rec.text;
  if (typeof rec.content === 'string') return rec.content;
  if (Array.isArray(rec.content)) {
    return rec.content
      .filter((b) => b.type === 'text' || !b.type)
      .map((b) => b.text ?? '')
      .join('')
      || null;
  }
  return null;
}

function makeEvent(partial: Partial<SessionEvent> & { id: string; kind: EventKind }): SessionEvent {
  return {
    id: partial.id,
    kind: partial.kind,
    timestamp: partial.timestamp ?? null,
    role: partial.role ?? null,
    text: partial.text ?? null,
    toolName: partial.toolName ?? null,
    toolInput: partial.toolInput ?? null,
    toolOutput: partial.toolOutput ?? null,
    messageId: partial.messageId ?? null,
    parentId: partial.parentId ?? null,
    isDelta: partial.isDelta ?? false,
    rawJson: partial.rawJson ?? null,
  };
}

function safeDate(s: string | number): Date | null {
  try {
    const d = typeof s === 'number' ? new Date(s * 1000) : new Date(s);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function generateId(seed: string): string {
  return createHash('sha1').update(seed).digest('hex').slice(0, 16);
}
