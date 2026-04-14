// ---- Core enums / types ----

export type Provider = 'claude' | 'codex' | 'cursor';

export type EventKind =
  | 'user'
  | 'assistant'
  | 'tool_call'
  | 'tool_result'
  | 'meta'
  | 'error';

export type ExportFormat = 'pdf' | 'docx';
export type ExportMode = 'single' | 'combined' | 'split-provider' | 'split-repo';

// ---- Content blocks (mirrors Anthropic format) ----

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | TextBlock[];
  is_error?: boolean;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

export interface ImageBlock {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
}

export type ContentBlock =
  | TextBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock
  | ImageBlock;

// ---- Normalized session event ----

export interface SessionEvent {
  id: string;
  kind: EventKind;
  timestamp: Date | null;
  role: string | null;

  // Primary text content
  text: string | null;

  // Tool-specific fields
  toolName: string | null;
  toolInput: string | null;   // JSON-serialized
  toolOutput: string | null;  // JSON-serialized, capped at 8 KB

  // Threading
  messageId: string | null;
  parentId: string | null;
  isDelta: boolean;

  // Raw payload (capped at 8 KB)
  rawJson: string | null;
}

// ---- Git context ----

export interface GitContext {
  repoRoot: string | null;
  repoName: string | null;
  branch: string | null;
  isWorktree: boolean;
  worktreeRoot: string | null;
}

// ---- The unified session ----

export interface Session {
  id: string;
  provider: Provider;
  filePath: string;

  title: string | null;
  model: string | null;

  startTime: Date | null;
  endTime: Date | null;

  cwd: string | null;
  git: GitContext | null;

  events: SessionEvent[];
  eventCount: number;

  fileSizeBytes: number | null;
  isHousekeeping: boolean;
  isFullyParsed: boolean;
}

// ---- Discovery ----

export interface DiscoveryResult {
  sessions: Session[];
  errors: DiscoveryError[];
}

export interface DiscoveryError {
  filePath: string;
  provider: Provider;
  message: string;
  cause?: Error;
}

// ---- Export options ----

export interface ExportOptions {
  format: ExportFormat;
  mode: ExportMode;
  outputDir: string;
  includeToolCalls: boolean;
  includeMetaEvents: boolean;
  includeThinking: boolean;
  includeTimestamps: boolean;
  maxToolOutputLines: number;
}

// ---- Filter criteria ----

export interface FilterOptions {
  provider?: Provider[];
  repo?: string;
  worktree?: boolean;
  session?: string;
  since?: Date;
  until?: Date;
  noHousekeeping?: boolean;
}
