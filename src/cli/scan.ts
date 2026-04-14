import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import type { Provider } from '../schema.js';
import { discoverSessions } from '../discovery.js';

export function createScanCommand(): Command {
  return new Command('scan')
    .description('Scan and list detected AI session providers and counts')
    .option('-p, --provider <provider...>', 'Filter by provider: claude, codex, cursor, gemini, opencode, copilot')
    .option('--since <date>', 'Only sessions after this date (ISO 8601)')
    .option('--until <date>', 'Only sessions before this date (ISO 8601)')
    .option('--json', 'Output raw JSON')
    .option('--claude-root <path>', 'Override ~/.claude directory')
    .option('--codex-root <path>', 'Override ~/.codex directory')
    .option('--cursor-root <path>', 'Override ~/.cursor directory')
    .option('--gemini-root <path>', 'Override ~/.gemini directory')
    .option('--opencode-root <path>', 'Override ~/.local/share/opencode directory')
    .option('--copilot-root <path>', 'Override ~/.copilot directory')
    .action(async (opts) => {
      const spinner = ora('Scanning sessions…').start();

      try {
        const { sessions, errors } = await discoverSessions({
          providers: opts.provider as Provider[] | undefined,
          claudeRoot: opts.claudeRoot,
          codexRoot: opts.codexRoot,
          cursorRoot: opts.cursorRoot,
          geminiRoot: opts.geminiRoot,
          openCodeRoot: opts.openCodeRoot,
          copilotRoot: opts.copilotRoot,
          filter: {
            since: opts.since ? new Date(opts.since) : undefined,
            until: opts.until ? new Date(opts.until) : undefined,
          },
        });

        spinner.stop();

        if (opts.json) {
          console.log(JSON.stringify({ sessions, errors }, null, 2));
          return;
        }

        if (sessions.length === 0) {
          console.log(chalk.yellow('No sessions found.'));
          printErrors(errors);
          return;
        }

        // Group by provider
        const byProvider = new Map<string, typeof sessions>();
        for (const s of sessions) {
          const group = byProvider.get(s.provider) ?? [];
          group.push(s);
          byProvider.set(s.provider, group);
        }

        console.log(chalk.bold('\nSession Summary\n'));
        console.log(
          chalk.gray(
            padEnd('Provider', 10) +
            padEnd('Sessions', 10) +
            padEnd('Oldest', 22) +
            padEnd('Newest', 22) +
            'Total Size'
          )
        );
        console.log(chalk.gray('─'.repeat(80)));

        for (const [provider, group] of byProvider) {
          const times = group
            .map((s) => s.startTime?.getTime() ?? s.endTime?.getTime() ?? 0)
            .filter((t) => t > 0);
          const oldest = times.length ? new Date(Math.min(...times)).toISOString().slice(0, 10) : 'unknown';
          const newest = times.length ? new Date(Math.max(...times)).toISOString().slice(0, 10) : 'unknown';
          const totalBytes = group.reduce((sum, s) => sum + (s.fileSizeBytes ?? 0), 0);

          console.log(
            chalk.cyan(padEnd(provider, 10)) +
            padEnd(String(group.length), 10) +
            padEnd(oldest, 22) +
            padEnd(newest, 22) +
            formatBytes(totalBytes)
          );
        }

        console.log(chalk.gray('─'.repeat(80)));
        console.log(chalk.bold(`Total: ${sessions.length} sessions`));

        printErrors(errors);
      } catch (err) {
        spinner.stop();
        console.error(chalk.red('Error:'), err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });
}

function printErrors(errors: Array<{ filePath: string; message: string }>): void {
  if (errors.length > 0) {
    console.log(chalk.yellow(`\n${errors.length} file(s) could not be read:`));
    for (const e of errors.slice(0, 5)) {
      console.log(chalk.gray(`  ${e.filePath}: ${e.message}`));
    }
    if (errors.length > 5) {
      console.log(chalk.gray(`  … and ${errors.length - 5} more`));
    }
  }
}

function padEnd(s: string, len: number): string {
  return s.padEnd(len);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
