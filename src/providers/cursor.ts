import { statSync, existsSync } from 'fs';
import { dirname, basename, join } from 'path';
import { createHash } from 'crypto';
import type { ProviderAdapter } from './base.js';
import type { Session, SessionEvent, EventKind } from '../schema.js';
import { readJsonlFile } from '../util/jsonl.js';
import { capBytes, redactBase64Images } from '../util/paths.js';
import { normalizeEventKind, extractTitle, isHousekeepingSession } from '../normalize.js';
import { ParseError } from '../util/errors.js';

const RAW_JSON_CAP = 8192;

// ---- Raw record shapes for Cursor JSONL ----

interface CursorContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  thinking?: string;
}

interface CursorRawRecord {
  role?: string;
  content?: CursorContentBlock[] | string;
}

// ---- SQLite chat data shapes ----

interface CursorChatBubble {
  type?: string;
  text?: string;
  codeBlocks?: Array<{ code?: string; language?: string }>;
}

interface CursorChatTab {
  chatTitle?: string;
  bubbles?: CursorChatBubble[];
}

interface CursorChatData {
  tabs?: CursorChatTab[];
}

export class CursorAdapter implements ProviderAdapter {
  readonly provider = 'cursor' as const;

  async scanFile(filePath: string): Promise<Session> {
    try {
      if (filePath.endsWith('store.db') || filePath.endsWith('state.vscdb')) {
        return await this.scanSqliteFile(filePath);
      }
      return await this.scanJsonlFile(filePath);
    } catch (err) {
      throw new ParseError(filePath, 'cursor', err instanceof Error ? err : undefined);
    }
  }

  async parseFile(filePath: string): Promise<Session> {
    try {
      if (filePath.endsWith('store.db') || filePath.endsWith('state.vscdb')) {
        return await this.parseSqliteFile(filePath);
      }
      return await this.parseJsonlFile(filePath);
    } catch (err) {
      throw new ParseError(filePath, 'cursor', err instanceof Error ? err : undefined);
    }
  }

  // ---- JSONL path ----

  private async scanJsonlFile(filePath: string): Promise<Session> {
    const stat = statSync(filePath);
    const id = extractCursorSessionId(filePath);
    const cwd = extractCursorCwd(filePath);
    let firstUserText: string | null = null;

    for await (const raw of readJsonlFile(filePath, { maxLines: 100 })) {
      const rec = raw as CursorRawRecord;
      const kind = normalizeEventKind(undefined, rec.role);
      if (kind === 'user' && !firstUserText) {
        firstUserText = extractCursorText(rec);
      }
      if (firstUserText) break;
    }

    return {
      id,
      provider: 'cursor',
      filePath,
      title: firstUserText ? stripCursorTags(firstUserText).slice(0, 120) : null,
      model: null,
      startTime: null,
      endTime: new Date(stat.mtimeMs),
      cwd,
      git: null,
      events: [],
      eventCount: Math.round(stat.size / 200),
      fileSizeBytes: stat.size,
      isHousekeeping: false,
      isFullyParsed: false,
    };
  }

  private async parseJsonlFile(filePath: string): Promise<Session> {
    const stat = statSync(filePath);
    const id = extractCursorSessionId(filePath);
    const cwd = extractCursorCwd(filePath);
    const events: SessionEvent[] = [];

    for await (const raw of readJsonlFile(filePath)) {
      const rec = raw as CursorRawRecord;
      const evs = parseCursorRecord(rec, id);
      events.push(...evs);
    }

    return {
      id,
      provider: 'cursor',
      filePath,
      title: extractTitle(events),
      model: null,
      startTime: null,
      endTime: new Date(stat.mtimeMs),
      cwd,
      git: null,
      events,
      eventCount: events.filter((e) => e.kind !== 'meta').length,
      fileSizeBytes: stat.size,
      isHousekeeping: isHousekeepingSession(events),
      isFullyParsed: true,
    };
  }

  // ---- SQLite path ----

  private async scanSqliteFile(filePath: string): Promise<Session> {
    const stat = statSync(filePath);
    const id = extractCursorSessionIdFromDb(filePath);
    const chatData = queryCursorDb(filePath);
    const firstTab = chatData?.tabs?.[0];
    const title = firstTab?.chatTitle ?? null;

    return {
      id,
      provider: 'cursor',
      filePath,
      title,
      model: null,
      startTime: null,
      endTime: new Date(stat.mtimeMs),
      cwd: null,
      git: null,
      events: [],
      eventCount: firstTab?.bubbles?.length ?? 0,
      fileSizeBytes: stat.size,
      isHousekeeping: false,
      isFullyParsed: false,
    };
  }

  private async parseSqliteFile(filePath: string): Promise<Session> {
    const stat = statSync(filePath);
    const id = extractCursorSessionIdFromDb(filePath);
    const chatData = queryCursorDb(filePath);
    const events: SessionEvent[] = [];

    if (chatData?.tabs) {
      for (const tab of chatData.tabs) {
        if (tab.bubbles) {
          for (const bubble of tab.bubbles) {
            const kind: EventKind = bubble.type === 'ai' ? 'assistant' : 'user';
            events.push({
              id: generateId((bubble.text ?? '') + events.length),
              kind,
              timestamp: null,
              role: bubble.type === 'ai' ? 'assistant' : 'user',
              text: bubble.text ?? null,
              toolName: null,
              toolInput: null,
              toolOutput: null,
              messageId: null,
              parentId: null,
              isDelta: false,
              rawJson: null,
            });
          }
        }
      }
    }

    return {
      id,
      provider: 'cursor',
      filePath,
      title: chatData?.tabs?.[0]?.chatTitle ?? extractTitle(events),
      model: null,
      startTime: null,
      endTime: new Date(stat.mtimeMs),
      cwd: null,
      git: null,
      events,
      eventCount: events.filter((e) => e.kind !== 'meta').length,
      fileSizeBytes: stat.size,
      isHousekeeping: isHousekeepingSession(events),
      isFullyParsed: true,
    };
  }
}

// ---- Internal helpers ----

function parseCursorRecord(rec: CursorRawRecord, sessionId: string): SessionEvent[] {
  const events: SessionEvent[] = [];
  const kind = normalizeEventKind(undefined, rec.role);
  const raw = capBytes(JSON.stringify(rec), RAW_JSON_CAP);

  if (!rec.content) return [];

  if (typeof rec.content === 'string') {
    events.push(makeEvent({
      id: generateId(rec.content + sessionId),
      kind,
      timestamp: null,
      role: rec.role ?? null,
      text: stripCursorTags(rec.content),
      rawJson: raw,
    }));
    return events;
  }

  if (Array.isArray(rec.content)) {
    for (const block of rec.content) {
      const blockType = block.type ?? '';

      if (blockType === 'text' && block.text) {
        events.push(makeEvent({
          id: generateId(block.text + sessionId + events.length),
          kind,
          timestamp: null,
          role: rec.role ?? null,
          text: stripCursorTags(block.text),
          rawJson: null,
        }));
      } else if (blockType === 'thinking' && block.thinking) {
        events.push(makeEvent({
          id: generateId(block.thinking + sessionId),
          kind: 'meta',
          timestamp: null,
          role: 'thinking',
          text: block.thinking,
          rawJson: null,
        }));
      } else if (blockType === 'tool_use') {
        const inputStr = block.input !== undefined
          ? capBytes(JSON.stringify(block.input), RAW_JSON_CAP)
          : null;
        events.push(makeEvent({
          id: block.id ?? generateId(raw + events.length),
          kind: 'tool_call',
          timestamp: null,
          role: 'assistant',
          toolName: block.name ?? null,
          toolInput: inputStr,
          rawJson: null,
        }));
      } else if (blockType === 'tool_result') {
        const contentRaw = block.content;
        let outputText: string | null = null;
        if (typeof contentRaw === 'string') {
          outputText = capBytes(redactBase64Images(contentRaw), RAW_JSON_CAP);
        } else if (Array.isArray(contentRaw)) {
          outputText = capBytes(
            redactBase64Images(
              (contentRaw as CursorContentBlock[]).map((b) => b.text ?? '').join('\n')
            ),
            RAW_JSON_CAP
          );
        }
        events.push(makeEvent({
          id: generateId((block.tool_use_id ?? '') + sessionId + events.length),
          kind: 'tool_result',
          timestamp: null,
          role: 'tool',
          toolOutput: outputText,
          rawJson: null,
        }));
      }
    }
  }

  return events;
}

/**
 * Strip XML wrapper tags (e.g. <user_query>) from Cursor text content,
 * preserving the inner text.
 */
function stripCursorTags(text: string): string {
  return text
    .replace(/<(user_query|cwd|context)[^>]*>([\s\S]*?)<\/\1>/gi, '$2')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function extractCursorText(rec: CursorRawRecord): string | null {
  if (typeof rec.content === 'string') return stripCursorTags(rec.content);
  if (Array.isArray(rec.content)) {
    const textBlock = rec.content.find((b) => b.type === 'text');
    return textBlock?.text ? stripCursorTags(textBlock.text) : null;
  }
  return null;
}

/** Extract session ID from JSONL path: .../agent-transcripts/<sessionId>/<uuid>.jsonl */
function extractCursorSessionId(filePath: string): string {
  const parts = filePath.split('/');
  // The directory two levels up from the file is the session ID
  if (parts.length >= 3) {
    const candidate = parts[parts.length - 2];
    if (candidate && /^[a-f0-9-]{8,}$/i.test(candidate)) {
      return candidate;
    }
  }
  return createHash('sha1').update(filePath).digest('hex').slice(0, 16);
}

/**
 * Extract session ID from SQLite path.
 * - store.db:    .../chats/<md5>/<sessionUUID>/store.db  → sessionUUID
 * - state.vscdb: .../workspaceStorage/<hash>/state.vscdb → hash
 */
function extractCursorSessionIdFromDb(filePath: string): string {
  const candidate = basename(dirname(filePath));
  if (candidate && /^[a-f0-9-]{8,}$/i.test(candidate)) {
    return candidate;
  }
  return createHash('sha1').update(filePath).digest('hex').slice(0, 16);
}

/**
 * Reconstruct CWD from Cursor's encoded project directory name.
 * ~/.cursor/projects/<encoded-name>/... where encoded uses hyphens for slashes.
 */
function extractCursorCwd(filePath: string): string | null {
  const match = filePath.match(/\.cursor\/projects\/([^/]+)\//);
  if (match && match[1]) {
    const encoded = match[1];
    // Decode: leading hyphen → '/'
    if (encoded.startsWith('-')) {
      return encoded.replace(/-/g, '/');
    }
  }
  return null;
}

/**
 * Query the Cursor SQLite chat database.
 * Returns null if the DB cannot be opened or the key is not found.
 */
function queryCursorDb(dbPath: string): CursorChatData | null {
  try {
    // Dynamic require to avoid top-level import crash when better-sqlite3 isn't installed
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3') as typeof import('better-sqlite3');
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const row = db
        .prepare(
          `SELECT value FROM ItemTable WHERE key = 'workbench.panel.aichat.view.aichat.chatdata'`
        )
        .get() as { value: string } | undefined;
      if (!row) return null;
      return JSON.parse(row.value) as CursorChatData;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
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

function generateId(seed: string): string {
  return createHash('sha1').update(seed).digest('hex').slice(0, 16);
}
