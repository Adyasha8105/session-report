import { statSync, existsSync } from 'fs';
import { dirname, basename } from 'path';
import { createHash } from 'crypto';
import type { ProviderAdapter } from './base.js';
import type { Session, SessionEvent, EventKind } from '../schema.js';
import { readJsonlFile } from '../util/jsonl.js';
import { capBytes, redactBase64Images } from '../util/paths.js';
import { extractTitle, isHousekeepingSession } from '../normalize.js';
import { ParseError } from '../util/errors.js';

const RAW_JSON_CAP = 8192;

// ---- Raw shapes ----

interface CopilotEventData {
  sessionId?: string;
  workspacePath?: string;
  model?: string;
  text?: string;
  timestamp?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  toolRequests?: Array<{ toolCallId?: string; toolName?: string; input?: unknown }>;
}

interface CopilotRawEvent {
  type?: string;
  data?: CopilotEventData;
}

export class CopilotAdapter implements ProviderAdapter {
  readonly provider = 'copilot' as const;

  async scanFile(filePath: string): Promise<Session> {
    try {
      const stat = statSync(filePath);
      let sessionId: string | null = null;
      let model: string | null = null;
      let cwd: string | null = null;
      let firstUserText: string | null = null;
      let startTime: Date | null = null;

      for await (const raw of readJsonlFile(filePath, { maxLines: 50 })) {
        const ev = raw as CopilotRawEvent;
        if (ev.type === 'session.start') {
          sessionId = ev.data?.sessionId ?? null;
          cwd = ev.data?.workspacePath ?? null;
        } else if (ev.type === 'session.model_change' && !model) {
          model = ev.data?.model ?? null;
        } else if (ev.type === 'user.message' && !firstUserText) {
          firstUserText = ev.data?.text ?? null;
          if (ev.data?.timestamp) {
            startTime = safeDate(ev.data.timestamp);
          }
        }
        if (sessionId && model && firstUserText) break;
      }

      return {
        id: sessionId ?? fileHash(filePath),
        provider: 'copilot',
        filePath,
        title: firstUserText ? firstUserText.slice(0, 120) : null,
        model,
        startTime,
        endTime: new Date(stat.mtimeMs),
        cwd,
        git: null,
        events: [],
        eventCount: Math.round(stat.size / 200),
        fileSizeBytes: stat.size,
        isHousekeeping: false,
        isFullyParsed: false,
      };
    } catch (err) {
      throw new ParseError(filePath, 'copilot', err instanceof Error ? err : undefined);
    }
  }

  async parseFile(filePath: string): Promise<Session> {
    try {
      const stat = statSync(filePath);
      let sessionId: string | null = null;
      let model: string | null = null;
      let cwd: string | null = null;
      let startTime: Date | null = null;
      const events: SessionEvent[] = [];

      // Track tool call id → name for joining tool results
      const toolNameMap = new Map<string, string>();

      for await (const raw of readJsonlFile(filePath)) {
        const ev = raw as CopilotRawEvent;
        const evType = ev.type ?? '';
        const data = ev.data ?? {};

        if (evType === 'session.start') {
          sessionId = data.sessionId ?? null;
          cwd = data.workspacePath ?? null;
          continue;
        }

        if (evType === 'session.model_change') {
          if (data.model) model = data.model;
          continue;
        }

        const ts = data.timestamp ? safeDate(data.timestamp) : null;

        if (evType === 'user.message') {
          if (!startTime && ts) startTime = ts;
          if (data.text) {
            events.push(makeEvent({
              id: generateId(data.text + events.length),
              kind: 'user',
              timestamp: ts,
              role: 'user',
              text: data.text,
            }));
          }
          continue;
        }

        if (evType === 'assistant.message') {
          if (data.text) {
            events.push(makeEvent({
              id: generateId(data.text + events.length),
              kind: 'assistant',
              timestamp: ts,
              role: 'assistant',
              text: data.text,
            }));
          }
          // Inline tool requests on the assistant message
          if (Array.isArray(data.toolRequests)) {
            for (const req of data.toolRequests) {
              if (req.toolCallId) toolNameMap.set(req.toolCallId, req.toolName ?? '');
              const inputStr = req.input !== undefined
                ? capBytes(JSON.stringify(req.input), RAW_JSON_CAP)
                : null;
              events.push(makeEvent({
                id: generateId((req.toolCallId ?? '') + events.length),
                kind: 'tool_call',
                timestamp: ts,
                role: 'assistant',
                toolName: req.toolName ?? null,
                toolInput: inputStr,
              }));
            }
          }
          continue;
        }

        if (evType === 'tool.execution_start') {
          if (data.toolCallId && data.toolName) {
            toolNameMap.set(data.toolCallId, data.toolName);
          }
          const inputStr = data.input !== undefined
            ? capBytes(JSON.stringify(data.input), RAW_JSON_CAP)
            : null;
          events.push(makeEvent({
            id: generateId((data.toolCallId ?? '') + events.length + 'start'),
            kind: 'tool_call',
            timestamp: ts,
            role: 'assistant',
            toolName: data.toolName ?? null,
            toolInput: inputStr,
          }));
          continue;
        }

        if (evType === 'tool.execution_complete') {
          const resolvedName = data.toolName
            ?? (data.toolCallId ? toolNameMap.get(data.toolCallId) : null)
            ?? null;
          let outputStr: string | null = null;
          if (data.output !== undefined) {
            const raw = typeof data.output === 'string'
              ? data.output
              : JSON.stringify(data.output);
            outputStr = capBytes(redactBase64Images(raw), RAW_JSON_CAP);
          }
          events.push(makeEvent({
            id: generateId((data.toolCallId ?? '') + events.length + 'complete'),
            kind: 'tool_result',
            timestamp: ts,
            role: 'tool',
            toolName: resolvedName,
            toolOutput: outputStr,
          }));
          continue;
        }

        // session.* and anything else → meta (skip silently)
      }

      return {
        id: sessionId ?? fileHash(filePath),
        provider: 'copilot',
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
      throw new ParseError(filePath, 'copilot', err instanceof Error ? err : undefined);
    }
  }
}

// ---- Internal helpers ----

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
