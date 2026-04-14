import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { CursorAdapter } from '../../src/providers/cursor.js';

const FIXTURE = join(__dirname, '../fixtures/cursor-sample.jsonl');

describe('CursorAdapter', () => {
  const adapter = new CursorAdapter();

  it('scanFile returns a lightweight session', async () => {
    const session = await adapter.scanFile(FIXTURE);
    expect(session.provider).toBe('cursor');
    expect(session.isFullyParsed).toBe(false);
    expect(session.events).toHaveLength(0);
  });

  it('scanFile strips XML tags from title', async () => {
    const session = await adapter.scanFile(FIXTURE);
    // Title should not contain XML tags
    expect(session.title).not.toContain('<user_query>');
    expect(session.title).toContain('TypeScript');
  });

  it('parseFile returns fully parsed session', async () => {
    const session = await adapter.parseFile(FIXTURE);
    expect(session.isFullyParsed).toBe(true);
    expect(session.events.length).toBeGreaterThan(0);
  });

  it('parseFile extracts user events with stripped tags', async () => {
    const session = await adapter.parseFile(FIXTURE);
    const userEvents = session.events.filter((e) => e.kind === 'user');
    expect(userEvents.length).toBeGreaterThan(0);
    // All user event text should have XML tags stripped
    for (const ev of userEvents) {
      expect(ev.text).not.toContain('<user_query>');
    }
  });

  it('parseFile extracts assistant events', async () => {
    const session = await adapter.parseFile(FIXTURE);
    const assistantEvents = session.events.filter((e) => e.kind === 'assistant');
    expect(assistantEvents.length).toBeGreaterThan(0);
  });

  it('parseFile extracts tool_call events from content blocks', async () => {
    const session = await adapter.parseFile(FIXTURE);
    const toolCalls = session.events.filter((e) => e.kind === 'tool_call');
    expect(toolCalls.length).toBeGreaterThan(0);
    expect(toolCalls[0]?.toolName).toBe('Write');
  });
});
