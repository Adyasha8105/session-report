import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { ClaudeAdapter } from '../../src/providers/claude.js';

const FIXTURE = join(__dirname, '../fixtures/claude-sample.jsonl');

describe('ClaudeAdapter', () => {
  const adapter = new ClaudeAdapter();

  it('scanFile returns a lightweight session', async () => {
    const session = await adapter.scanFile(FIXTURE);
    expect(session.provider).toBe('claude');
    expect(session.isFullyParsed).toBe(false);
    expect(session.events).toHaveLength(0);
    expect(session.id).toBeTruthy();
  });

  it('scanFile extracts sessionId', async () => {
    const session = await adapter.scanFile(FIXTURE);
    expect(session.id).toBe('abc123');
  });

  it('scanFile extracts title from summary record', async () => {
    const session = await adapter.scanFile(FIXTURE);
    expect(session.title).toBe('Fix the authentication bug');
  });

  it('scanFile extracts cwd and gitBranch', async () => {
    const session = await adapter.scanFile(FIXTURE);
    expect(session.cwd).toBe('/Users/dev/myproject');
  });

  it('parseFile returns fully parsed session', async () => {
    const session = await adapter.parseFile(FIXTURE);
    expect(session.isFullyParsed).toBe(true);
    expect(session.events.length).toBeGreaterThan(0);
  });

  it('parseFile extracts user events', async () => {
    const session = await adapter.parseFile(FIXTURE);
    const userEvents = session.events.filter((e) => e.kind === 'user');
    expect(userEvents.length).toBeGreaterThan(0);
    const firstUser = userEvents[0];
    expect(firstUser?.text).toContain('authentication bug');
  });

  it('parseFile extracts assistant events with text', async () => {
    const session = await adapter.parseFile(FIXTURE);
    const assistantEvents = session.events.filter((e) => e.kind === 'assistant');
    expect(assistantEvents.length).toBeGreaterThan(0);
    const firstAssistant = assistantEvents[0];
    expect(firstAssistant?.text).toBeTruthy();
  });

  it('parseFile extracts tool_call events', async () => {
    const session = await adapter.parseFile(FIXTURE);
    const toolCalls = session.events.filter((e) => e.kind === 'tool_call');
    expect(toolCalls.length).toBeGreaterThan(0);
    expect(toolCalls[0]?.toolName).toBe('Read');
  });

  it('parseFile extracts tool_result events', async () => {
    const session = await adapter.parseFile(FIXTURE);
    const toolResults = session.events.filter((e) => e.kind === 'tool_result');
    expect(toolResults.length).toBeGreaterThan(0);
  });

  it('parseFile detects model', async () => {
    const session = await adapter.parseFile(FIXTURE);
    expect(session.model).toBe('claude-opus-4-5');
  });

  it('parseFile marks non-housekeeping session correctly', async () => {
    const session = await adapter.parseFile(FIXTURE);
    expect(session.isHousekeeping).toBe(false);
  });
});
