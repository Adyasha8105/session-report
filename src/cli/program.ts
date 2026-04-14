import { Command } from 'commander';
import { createScanCommand } from './scan.js';
import { createListCommand } from './list.js';
import { createExportCommand } from './export.js';

export function createProgram(): Command {
  const program = new Command()
    .name('session-report')
    .description('Export AI coding assistant sessions (Claude Code, Codex CLI, Cursor, Gemini CLI, OpenCode, GitHub Copilot) to PDF or DOCX')
    .version('1.0.0');

  program.addCommand(createScanCommand());
  program.addCommand(createListCommand());
  program.addCommand(createExportCommand());

  return program;
}
