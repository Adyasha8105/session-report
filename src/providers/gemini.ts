import { statSync, readdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import type { ProviderAdapter } from './base.js';
import type { Session, SessionEvent, EventKind } from '../schema.js';
import { capBytes, redactBase64Images } from '../util/paths.js';
import { normalizeEventKind, extractTitle, isHousekeepingSession } from '../normalize.js';
import { ParseError } from '../util/errors.js';

const RAW_JSON_CAP = 8192;

// ---- Raw record shapes for Gemini CLI JSON ----

interface GeminiContentPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
}

interface GeminiToolCall {
  name?: string;
  input?: unknown;
  arguments?: unknown; // alias used by some Gemini CLI versions
}

interface GeminiRawMessage {
  type?: string;
  role?: string;
  id?: string;
  uuid?: string;
  parentId?: string;
  timestamp?: string | number;
  ts?: string | number;
  created_at?: string | number;
  time?: string | number;
  content?: GeminiContentPart[] | string;
  text?: string;
  parts?: GeminiContentPart[];
  tool?: string;
  name?: string;
  input?: unknown;
  arguments?: unknown; // alias used by some Gemini CLI versions
  output?: unknown;
  model?: string;
}

interface GeminiSessionJson {
  sessionId?: string;
  messages?: GeminiRawMessage[];
  history?: GeminiRawMessage[];
  startTime?: string | number;
  lastUpdated?: string | number;
  model?: string;
  projectHash?: string;
}

export class GeminiAdapter implements ProviderAdapter {
  readonly provider = 'gemini' as const;

  async scanFile(filePath: string): Promise<Session> {
    try {
      const stat = statSync(filePath);
      const raw = await readFile(filePath, 'utf8');
      const data = parseGeminiJson(raw);
      const messages = extractMessages(data);
      const firstUser = messages.find(
        (m) => normalizeEventKind(m.type, m.role) === 'user'
      );
      const title = extractTextFromMessage(firstUser)?.slice(0, 120) ?? null;

      return {
        id: data.sessionId ?? fileHash(filePath),
        provider: 'gemini',
        filePath,
        title,
        model: data.model ?? null,
        startTime: safeDate(data.startTime),
        endTime: new Date(stat.mtimeMs),
        cwd: null,
        git: null,
        events: [],
        eventCount: messages.length,
        fileSizeBytes: stat.size,
        isHousekeeping: false,
        isFullyParsed: false,
      };
    } catch (err) {
      throw new ParseError(filePath, 'gemini', err instanceof Error ? err : undefined);
    }
  }

  async parseFile(filePath: string): Promise<Session> {
    try {
      const stat = statSync(filePath);
      const raw = await readFile(filePath, 'utf8');
      const data = parseGeminiJson(raw);
      const messages = extractMessages(data);
      const events: SessionEvent[] = [];

      for (const msg of messages) {
        const evs = parseGeminiMessage(msg);
        events.push(...evs);
      }

      return {
        id: data.sessionId ?? fileHash(filePath),
        provider: 'gemini',
        filePath,
        title: extractTitle(events),
        model: data.model ?? null,
        startTime: safeDate(data.startTime),
        endTime: new Date(stat.mtimeMs),
        cwd: null,
        git: null,
        events,
        eventCount: events.filter((e) => e.kind !== 'meta').length,
        fileSizeBytes: stat.size,
        isHousekeeping: isHousekeepingSession(events),
        isFullyParsed: true,
      };
    } catch (err) {
      throw new ParseError(filePath, 'gemini', err instanceof Error ? err : undefined);
    }
  }
}

// ---- Internal helpers ----

function parseGeminiJson(raw: string): GeminiSessionJson {
  const parsed: unknown = JSON.parse(raw);
  // Handle array-root format
  if (Array.isArray(parsed)) {
    return { messages: parsed as GeminiRawMessage[] };
  }
  return parsed as GeminiSessionJson;
}

function extractMessages(data: GeminiSessionJson): GeminiRawMessage[] {
  return data.messages ?? data.history ?? [];
}

function parseGeminiMessage(msg: GeminiRawMessage): SessionEvent[] {
  const events: SessionEvent[] = [];
  const kind = normalizeEventKind(msg.type, msg.role);
  const ts = safeDate(msg.timestamp ?? msg.ts ?? msg.created_at ?? msg.time);
  const raw = capBytes(JSON.stringify(msg), RAW_JSON_CAP);

  // Tool call
  if (kind === 'tool_call') {
    const inputStr = msg.input !== undefined
      ? capBytes(JSON.stringify(msg.input ?? msg.arguments), RAW_JSON_CAP)
      : null;
    events.push(makeEvent({
      id: msg.id ?? msg.uuid ?? generateId(raw),
      kind: 'tool_call',
      timestamp: ts,
      role: 'assistant',
      toolName: msg.tool ?? msg.name ?? null,
      toolInput: inputStr,
      messageId: msg.id ?? null,
      parentId: msg.parentId ?? null,
      rawJson: raw,
    }));
    return events;
  }

  // Tool result
  if (kind === 'tool_result') {
    const outputStr = msg.output !== undefined
      ? capBytes(redactBase64Images(JSON.stringify(msg.output)), RAW_JSON_CAP)
      : null;
    events.push(makeEvent({
      id: msg.id ?? msg.uuid ?? generateId(raw),
      kind: 'tool_result',
      timestamp: ts,
      role: 'tool',
      toolOutput: outputStr,
      messageId: msg.id ?? null,
      parentId: msg.parentId ?? null,
      rawJson: raw,
    }));
    return events;
  }

  const text = extractTextFromMessage(msg);
  if (!text && kind === 'meta') return [];

  events.push(makeEvent({
    id: msg.id ?? msg.uuid ?? generateId(raw),
    kind,
    timestamp: ts,
    role: msg.role ?? msg.type ?? null,
    text,
    messageId: msg.id ?? null,
    parentId: msg.parentId ?? null,
    rawJson: raw,
  }));

  return events;
}

function extractTextFromMessage(msg: GeminiRawMessage | undefined): string | null {
  if (!msg) return null;
  if (msg.text) return msg.text;
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content.map((p) => p.text ?? '').filter(Boolean).join('') || null;
  }
  if (Array.isArray(msg.parts)) {
    return msg.parts.map((p) => p.text ?? '').filter(Boolean).join('') || null;
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
    isDelta: false,
    rawJson: partial.rawJson ?? null,
  };
}

function safeDate(v: string | number | undefined | null): Date | null {
  if (v === undefined || v === null) return null;
  try {
    const d = typeof v === 'number' ? new Date(v) : new Date(v);
    return isNaN(d.getTime()) ? null : d;
  } catch { return null; }
}

function fileHash(filePath: string): string {
  return createHash('sha1').update(filePath).digest('hex').slice(0, 16);
}

function generateId(seed: string): string {
  return createHash('sha1').update(seed).digest('hex').slice(0, 16);
}
