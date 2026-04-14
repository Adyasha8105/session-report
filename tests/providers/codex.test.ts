import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { CodexAdapter } from '../../src/providers/codex.js';

// Use a real filename pattern that matches Codex format for the fixture
const FIXTURE = join(__dirname, '../fixtures/codex-sample.jsonl');

describe('CodexAdapter', () => {
  const adapter = new CodexAdapter();

  it('scanFile returns a lightweight session', async () => {
    const session = await adapter.scanFile(FIXTURE);
    expect(session.provider).toBe('codex');
    expect(session.isFullyParsed).toBe(false);
    expect(session.events).toHaveLength(0);
  });

  it('scanFile extracts cwd and branch', async () => {
    const session = await adapter.scanFile(FIXTURE);
    expect(session.cwd).toBe('/Users/dev/myproject');
  });

  it('scanFile extracts model', async () => {
    const session = await adapter.scanFile(FIXTURE);
    expect(session.model).toBe('claude-opus-4-5');
  });

  it('scanFile extracts first user text as title', async () => {
    const session = await adapter.scanFile(FIXTURE);
    expect(session.title).toContain('Refactor');
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
    expect(userEvents[0]?.text).toContain('Refactor');
  });

  it('parseFile extracts assistant events', async () => {
    const session = await adapter.parseFile(FIXTURE);
    const assistantEvents = session.events.filter((e) => e.kind === 'assistant');
    expect(assistantEvents.length).toBeGreaterThan(0);
  });

  it('parseFile extracts tool_call events from tool_calls array', async () => {
    const session = await adapter.parseFile(FIXTURE);
    const toolCalls = session.events.filter((e) => e.kind === 'tool_call');
    expect(toolCalls.length).toBeGreaterThan(0);
    expect(toolCalls[0]?.toolName).toBe('read_file');
  });

  it('parseFile extracts tool_result events', async () => {
    const session = await adapter.parseFile(FIXTURE);
    const toolResults = session.events.filter((e) => e.kind === 'tool_result');
    expect(toolResults.length).toBeGreaterThan(0);
  });
});
