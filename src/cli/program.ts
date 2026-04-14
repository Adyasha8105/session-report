import { Command } from 'commander';
import chalk from 'chalk';
import { createScanCommand } from './scan.js';
import { createListCommand } from './list.js';
import { createExportCommand } from './export.js';
import { createCopyCommand } from './copy.js';

function printQuickHelp(): void {
  console.log(`
${chalk.bold('session-report')} — export AI coding sessions from Claude Code, Codex CLI, Cursor,
Gemini CLI, OpenCode, and GitHub Copilot to Markdown, DOCX, or JSON.

${chalk.bold('Quick commands:')}

  ${chalk.cyan('session-report scan')}                    Detect all sessions on this machine
  ${chalk.cyan('session-report list')}                    Browse sessions with filters
  ${chalk.cyan('session-report copy')}                    Copy latest session to clipboard
  ${chalk.cyan('session-report export')}                  Export sessions as Markdown (default)
  ${chalk.cyan('session-report export --format docx')}    Export as DOCX
  ${chalk.cyan('session-report export --format json')}    Export as JSON

Run ${chalk.cyan('session-report <command> --help')} for full options on any command.
`);
}

export function createProgram(): Command {
  const program = new Command()
    .name('session-report')
    .description('Export AI coding assistant sessions (Claude Code, Codex CLI, Cursor, Gemini CLI, OpenCode, GitHub Copilot) to DOCX, MD, or JSON')
    .version('1.0.9');

  program.addCommand(createScanCommand());
  program.addCommand(createListCommand());
  program.addCommand(createExportCommand());
  program.addCommand(createCopyCommand());

  program.on('command:*', (operands: string[]) => {
    console.error(chalk.red(`Unknown command: ${operands[0]}\n`));
    printQuickHelp();
    process.exit(1);
  });

  return program;
}
