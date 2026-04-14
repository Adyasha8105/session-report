import { statSync } from 'fs';
import { basename, dirname } from 'path';
import { createHash } from 'crypto';
import type { ProviderAdapter } from './base.js';
import type { Session, SessionEvent, EventKind } from '../schema.js';
import { readJsonlFile } from '../util/jsonl.js';
import { capBytes, redactBase64Images } from '../util/paths.js';
import { normalizeEventKind, extractTitle, isHousekeepingSession } from '../normalize.js';
import { ParseError } from '../util/errors.js';

const RAW_JSON_CAP = 8192;

// ---- Raw record shapes for Claude Code JSONL ----

interface ClaudeRawContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  thinking?: string;
  source?: { type?: string; media_type?: string; data?: string };
}

interface ClaudeRawMessage {
  id?: string;
  role?: string;
  model?: string;
  content?: ClaudeRawContentBlock[] | string;
}

interface ClaudeRawRecord {
  type?: string;
  sessionId?: string;
  uuid?: string;
  parentUuid?: string;
  timestamp?: string;
  isMeta?: boolean;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  message?: ClaudeRawMessage;
  summary?: string;
  title?: string;
  leafUuid?: string;
}

export class ClaudeAdapter implements ProviderAdapter {
  readonly provider = 'claude' as const;

  async scanFile(filePath: string): Promise<Session> {
    try {
      const stat = statSync(filePath);
      let sessionId: string | null = null;
      let cwd: string | null = null;
      let gitBranch: string | null = null;
      let model: string | null = null;
      let title: string | null = null;
      let firstTimestamp: Date | null = null;
      let firstUserText: string | null = null;

      for await (const raw of readJsonlFile(filePath, { maxLines: 200 })) {
        const rec = raw as ClaudeRawRecord;
        if (!sessionId && rec.sessionId) sessionId = rec.sessionId;
        if (!cwd && rec.cwd) cwd = rec.cwd;
        if (!gitBranch && rec.gitBranch) gitBranch = rec.gitBranch;
        if (!firstTimestamp && rec.timestamp) {
          firstTimestamp = safeDate(rec.timestamp);
        }
        if (rec.message?.model) model = rec.message.model;
        if (!model && rec.version) model = `claude-code@${rec.version}`;

        // Grab title from summary record
        if (!title && rec.type === 'summary') {
          title = rec.summary ?? rec.title ?? null;
        }

        // Grab first user message for title fallback
        if (!firstUserText && rec.type === 'user' && !rec.isMeta) {
          firstUserText = extractTextFromMessage(rec.message);
        }
      }

      if (!title && firstUserText) {
        title = firstUserText.slice(0, 120);
      }

      const id = sessionId ?? fileHash(filePath);

      return {
        id,
        provider: 'claude',
        filePath,
        title,
        model,
        startTime: firstTimestamp,
        endTime: new Date(stat.mtimeMs),
        cwd,
        git: null, // populated by discovery layer
        events: [],
        eventCount: Math.round(stat.size / 128),
        fileSizeBytes: stat.size,
        isHousekeeping: false,
        isFullyParsed: false,
      };
    } catch (err) {
      throw new ParseError(filePath, 'claude', err instanceof Error ? err : undefined);
    }
  }

  async parseFile(filePath: string): Promise<Session> {
    try {
      const stat = statSync(filePath);
      const events: SessionEvent[] = [];
      let sessionId: string | null = null;
      let cwd: string | null = null;
      let gitBranch: string | null = null;
      let model: string | null = null;
      let title: string | null = null;
      let firstTimestamp: Date | null = null;

      for await (const raw of readJsonlFile(filePath)) {
        const rec = raw as ClaudeRawRecord;

        if (!sessionId && rec.sessionId) sessionId = rec.sessionId;
        if (!cwd && rec.cwd) cwd = rec.cwd;
        if (!gitBranch && rec.gitBranch) gitBranch = rec.gitBranch;
        if (rec.message?.model) model = rec.message.model;
        if (!model && rec.version) model = `claude-code@${rec.version}`;
        if (!firstTimestamp && rec.timestamp) firstTimestamp = safeDate(rec.timestamp);

        if (!title && rec.type === 'summary') {
          title = rec.summary ?? rec.title ?? null;
        }

        const evs = parseClaudeRecord(rec);
        events.push(...evs);
      }

      if (!title) {
        title = extractTitle(events);
      }

      const id = sessionId ?? fileHash(filePath);
      const nonMetaEvents = events.filter((e) => e.kind !== 'meta');
      const lastTs = nonMetaEvents.length > 0
        ? nonMetaEvents[nonMetaEvents.length - 1]?.timestamp ?? null
        : null;

      return {
        id,
        provider: 'claude',
        filePath,
        title,
        model,
        startTime: firstTimestamp,
        endTime: lastTs ?? new Date(stat.mtimeMs),
        cwd,
        git: null,
        events,
        eventCount: events.filter((e) => e.kind !== 'meta').length,
        fileSizeBytes: stat.size,
        isHousekeeping: isHousekeepingSession(events),
        isFullyParsed: true,
      };
    } catch (err) {
      throw new ParseError(filePath, 'claude', err instanceof Error ? err : undefined);
    }
  }
}

// ---- Internal helpers ----

function parseClaudeRecord(rec: ClaudeRawRecord): SessionEvent[] {
  const events: SessionEvent[] = [];
  const ts = rec.timestamp ? safeDate(rec.timestamp) : null;
  const raw = capBytes(JSON.stringify(rec), RAW_JSON_CAP);

  const recType = rec.type ?? '';

  // Skip pure meta/housekeeping types
  if (['file-history-snapshot', 'queue-operation'].includes(recType)) {
    return [];
  }

  // Summary record → meta event
  if (recType === 'summary') {
    events.push(makeEvent({
      id: rec.uuid ?? generateId(raw),
      kind: 'meta',
      timestamp: ts,
      role: 'system',
      text: rec.summary ?? rec.title ?? null,
      parentId: null,
      messageId: rec.uuid ?? null,
      rawJson: raw,
    }));
    return events;
  }

  // User / assistant records — expand content blocks
  if (recType === 'user' || recType === 'assistant') {
    const msg = rec.message;
    if (!msg) return [];

    const kind: EventKind = rec.isMeta ? 'meta' : normalizeEventKind(recType, msg.role);
    const content = msg.content;

    if (!content) {
      return [];
    }

    if (typeof content === 'string') {
      events.push(makeEvent({
        id: rec.uuid ?? generateId(raw),
        kind,
        timestamp: ts,
        role: msg.role ?? recType,
        text: content,
        parentId: rec.parentUuid ?? null,
        messageId: msg.id ?? rec.uuid ?? null,
        rawJson: raw,
      }));
    } else if (Array.isArray(content)) {
      for (const block of content) {
        const blockEvents = parseContentBlock(block, kind, ts, rec.uuid, msg, raw);
        events.push(...blockEvents);
      }
    }

    return events;
  }

  // System / other records
  if (recType === 'system') {
    const text = typeof rec.message?.content === 'string' ? rec.message.content : null;
    events.push(makeEvent({
      id: rec.uuid ?? generateId(raw),
      kind: 'meta',
      timestamp: ts,
      role: 'system',
      text,
      parentId: null,
      messageId: null,
      rawJson: raw,
    }));
    return events;
  }

  return events;
}

function parseContentBlock(
  block: ClaudeRawContentBlock,
  parentKind: EventKind,
  ts: Date | null,
  parentUuid: string | undefined,
  msg: ClaudeRawMessage,
  rawJson: string
): SessionEvent[] {
  const blockType = block.type ?? '';

  if (blockType === 'text') {
    return [makeEvent({
      id: generateId(block.text ?? '' + (parentUuid ?? '')),
      kind: parentKind,
      timestamp: ts,
      role: msg.role ?? null,
      text: block.text ?? null,
      parentId: parentUuid ?? null,
      messageId: msg.id ?? null,
      rawJson: null,
    })];
  }

  if (blockType === 'thinking') {
    return [makeEvent({
      id: generateId(block.thinking ?? '' + (parentUuid ?? '')),
      kind: 'meta',
      timestamp: ts,
      role: 'thinking',
      text: block.thinking ?? null,
      parentId: parentUuid ?? null,
      messageId: msg.id ?? null,
      rawJson: null,
    })];
  }

  if (blockType === 'tool_use') {
    const inputStr = block.input !== undefined
      ? capBytes(JSON.stringify(block.input), RAW_JSON_CAP)
      : null;
    return [makeEvent({
      id: block.id ?? generateId(rawJson),
      kind: 'tool_call',
      timestamp: ts,
      role: 'assistant',
      text: null,
      toolName: block.name ?? null,
      toolInput: inputStr,
      parentId: parentUuid ?? null,
      messageId: msg.id ?? null,
      rawJson: null,
    })];
  }

  if (blockType === 'tool_result') {
    const contentRaw = block.content;
    let outputText: string | null = null;
    if (typeof contentRaw === 'string') {
      outputText = capBytes(redactBase64Images(contentRaw), RAW_JSON_CAP);
    } else if (Array.isArray(contentRaw)) {
      outputText = capBytes(
        redactBase64Images(contentRaw.map((b: ClaudeRawContentBlock) => b.text ?? '').join('\n')),
        RAW_JSON_CAP
      );
    }
    return [makeEvent({
      id: generateId((block.tool_use_id ?? '') + rawJson),
      kind: 'tool_result',
      timestamp: ts,
      role: 'tool',
      text: null,
      toolName: null,
      toolInput: null,
      toolOutput: outputText,
      parentId: parentUuid ?? null,
      messageId: msg.id ?? null,
      rawJson: null,
    })];
  }

  if (blockType === 'image') {
    const sizeKb = block.source?.data
      ? Math.round((block.source.data.length * 3) / 4 / 1024)
      : 0;
    return [makeEvent({
      id: generateId(rawJson),
      kind: parentKind,
      timestamp: ts,
      role: msg.role ?? null,
      text: `[image: ${block.source?.media_type ?? 'image'}, ~${sizeKb} KB]`,
      parentId: parentUuid ?? null,
      messageId: msg.id ?? null,
      rawJson: null,
    })];
  }

  return [];
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

function extractTextFromMessage(msg: ClaudeRawMessage | undefined): string | null {
  if (!msg) return null;
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    const textBlock = msg.content.find((b) => b.type === 'text');
    return textBlock?.text ?? null;
  }
  return null;
}

function safeDate(s: string): Date | null {
  try {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function fileHash(filePath: string): string {
  return createHash('sha1').update(filePath).digest('hex').slice(0, 16);
}

function generateId(seed: string): string {
  return createHash('sha1').update(seed).digest('hex').slice(0, 16);
}
