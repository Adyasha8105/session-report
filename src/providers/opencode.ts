import { statSync, existsSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { createHash } from 'crypto';
import { readFile } from 'fs/promises';
import type { ProviderAdapter } from './base.js';
import type { Session, SessionEvent, EventKind } from '../schema.js';
import { capBytes, redactBase64Images, expandTilde } from '../util/paths.js';
import { normalizeEventKind, extractTitle, isHousekeepingSession } from '../normalize.js';
import { ParseError } from '../util/errors.js';

const RAW_JSON_CAP = 8192;
const STORAGE_ROOT = '~/.local/share/opencode/storage';

// ---- Raw shapes ----

interface OpenCodeTime {
  created?: number;
  updated?: number;
}

interface OpenCodeModel {
  providerID?: string;
  modelID?: string;
}

interface OpenCodeSessionJson {
  id?: string;
  version?: string;
  projectID?: string;
  directory?: string;
  parentID?: string;
  title?: string;
  time?: OpenCodeTime;
}

interface OpenCodeMessageJson {
  id?: string;
  sessionID?: string;
  role?: string;
  time?: OpenCodeTime;
  model?: OpenCodeModel;
  agent?: string;
}

interface OpenCodePartJson {
  type?: string;
  text?: string;
  tool?: string;
  name?: string;
  input?: unknown;
  output?: unknown;
  error?: boolean;
  synthetic?: boolean;
}

export class OpenCodeAdapter implements ProviderAdapter {
  readonly provider = 'opencode' as const;

  async scanFile(filePath: string): Promise<Session> {
    try {
      const stat = statSync(filePath);
      const raw = await readFile(filePath, 'utf8');
      const data = JSON.parse(raw) as OpenCodeSessionJson;
      const sessionId = data.id ?? fileHash(filePath);

      // Estimate event count from message directory
      const storageRoot = expandTilde(STORAGE_ROOT);
      const msgDir = join(storageRoot, 'message', sessionId);
      let eventCount = 0;
      if (existsSync(msgDir)) {
        try {
          eventCount = readdirSync(msgDir).filter((f) => f.startsWith('msg_') && f.endsWith('.json')).length;
        } catch { /* ignore */ }
      }

      return {
        id: sessionId,
        provider: 'opencode',
        filePath,
        title: data.title ?? null,
        model: null,
        startTime: data.time?.created ? new Date(data.time.created) : null,
        endTime: data.time?.updated ? new Date(data.time.updated) : new Date(stat.mtimeMs),
        cwd: data.directory ?? null,
        git: null,
        events: [],
        eventCount,
        fileSizeBytes: stat.size,
        isHousekeeping: false,
        isFullyParsed: false,
      };
    } catch (err) {
      throw new ParseError(filePath, 'opencode', err instanceof Error ? err : undefined);
    }
  }

  async parseFile(filePath: string): Promise<Session> {
    try {
      const stat = statSync(filePath);
      const raw = await readFile(filePath, 'utf8');
      const data = JSON.parse(raw) as OpenCodeSessionJson;
      const sessionId = data.id ?? fileHash(filePath);
      const events: SessionEvent[] = [];
      let model: string | null = null;

      // Locate message files: storage/message/<sessionID>/msg_*.json
      const storageRoot = expandTilde(STORAGE_ROOT);
      const msgDir = join(storageRoot, 'message', sessionId);

      if (existsSync(msgDir)) {
        const msgFiles = readdirSync(msgDir)
          .filter((f) => f.startsWith('msg_') && f.endsWith('.json'))
          .sort();

        for (const msgFile of msgFiles) {
          const msgPath = join(msgDir, msgFile);
          try {
            const msgRaw = await readFile(msgPath, 'utf8');
            const msg = JSON.parse(msgRaw) as OpenCodeMessageJson;

            if (!model && msg.model?.modelID) {
              model = `${msg.model.providerID ?? ''}/${msg.model.modelID}`.replace(/^\//, '');
            }

            const kind = normalizeEventKind(undefined, msg.role);
            const ts = msg.time?.created ? new Date(msg.time.created) : null;
            const msgId = msg.id ?? fileHash(msgPath);

            // Load message parts
            const parts = await loadParts(storageRoot, msgId);

            if (parts.length > 0) {
              for (const part of parts) {
                const ev = partToEvent(part, kind, ts, msgId);
                if (ev) events.push(ev);
              }
            } else {
              // No parts — emit a placeholder event based on message metadata
              if (kind !== 'meta') {
                events.push(makeEvent({
                  id: msgId,
                  kind,
                  timestamp: ts,
                  role: msg.role ?? null,
                  messageId: msgId,
                }));
              }
            }
          } catch {
            // Skip unreadable message files
          }
        }
      }

      return {
        id: sessionId,
        provider: 'opencode',
        filePath,
        title: data.title ?? extractTitle(events),
        model,
        startTime: data.time?.created ? new Date(data.time.created) : null,
        endTime: data.time?.updated ? new Date(data.time.updated) : new Date(stat.mtimeMs),
        cwd: data.directory ?? null,
        git: null,
        events,
        eventCount: events.filter((e) => e.kind !== 'meta').length,
        fileSizeBytes: stat.size,
        isHousekeeping: isHousekeepingSession(events),
        isFullyParsed: true,
      };
    } catch (err) {
      throw new ParseError(filePath, 'opencode', err instanceof Error ? err : undefined);
    }
  }
}

// ---- Internal helpers ----

async function loadParts(storageRoot: string, messageId: string): Promise<OpenCodePartJson[]> {
  const parts: OpenCodePartJson[] = [];

  // v2 layout: storage/part/<messageID>/prt_*.json
  const partDir = join(storageRoot, 'part', messageId);
  if (existsSync(partDir)) {
    const files = readdirSync(partDir)
      .filter((f) => f.endsWith('.json'))
      .sort();
    for (const f of files) {
      try {
        const raw = await readFile(join(partDir, f), 'utf8');
        parts.push(JSON.parse(raw) as OpenCodePartJson);
      } catch { /* skip */ }
    }
  }

  return parts;
}

function partToEvent(
  part: OpenCodePartJson,
  parentKind: EventKind,
  ts: Date | null,
  messageId: string
): SessionEvent | null {
  const partType = part.type ?? '';

  if (partType === 'text' && part.text) {
    return makeEvent({
      id: generateId(part.text + messageId),
      kind: parentKind,
      timestamp: ts,
      text: part.text,
      messageId,
    });
  }

  if (partType === 'tool-invocation' || partType === 'tool_use') {
    const inputStr = part.input !== undefined
      ? capBytes(JSON.stringify(part.input), RAW_JSON_CAP)
      : null;
    return makeEvent({
      id: generateId((part.name ?? '') + messageId),
      kind: 'tool_call',
      timestamp: ts,
      role: 'assistant',
      toolName: part.tool ?? part.name ?? null,
      toolInput: inputStr,
      messageId,
    });
  }

  if (partType === 'tool-result' || partType === 'tool_result') {
    const outputStr = part.output !== undefined
      ? capBytes(redactBase64Images(JSON.stringify(part.output)), RAW_JSON_CAP)
      : null;
    return makeEvent({
      id: generateId((part.tool ?? '') + messageId + 'result'),
      kind: 'tool_result',
      timestamp: ts,
      role: 'tool',
      toolOutput: outputStr,
      messageId,
    });
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

function fileHash(filePath: string): string {
  return createHash('sha1').update(filePath).digest('hex').slice(0, 16);
}

function generateId(seed: string): string {
  return createHash('sha1').update(seed).digest('hex').slice(0, 16);
}
