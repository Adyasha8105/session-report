import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import type { Provider } from '../schema.js';
import { discoverSessions } from '../discovery.js';

export function createListCommand(): Command {
  return new Command('list')
    .description('List sessions with optional filters')
    .option('-p, --provider <provider...>', 'Filter by provider: claude, codex, cursor')
    .option('--repo <name>', 'Substring match on git repository name')
    .option('--worktree', 'Only show worktree sessions')
    .option('--session <id>', 'Filter by session ID prefix')
    .option('--since <date>', 'Only sessions after this date (ISO 8601)')
    .option('--until <date>', 'Only sessions before this date (ISO 8601)')
    .option('--limit <n>', 'Maximum number of sessions to show', '50')
    .option('--no-housekeeping', 'Exclude sessions with no assistant output')
    .option('--json', 'Output raw JSON')
    .option('--claude-root <path>', 'Override ~/.claude directory')
    .option('--codex-root <path>', 'Override ~/.codex directory')
    .option('--cursor-root <path>', 'Override ~/.cursor directory')
    .action(async (opts) => {
      const spinner = ora('Scanning sessions…').start();

      try {
        const { sessions, errors } = await discoverSessions({
          providers: opts.provider as Provider[] | undefined,
          claudeRoot: opts.claudeRoot,
          codexRoot: opts.codexRoot,
          cursorRoot: opts.cursorRoot,
          filter: {
            provider: opts.provider as Provider[] | undefined,
            repo: opts.repo,
            worktree: opts.worktree,
            session: opts.session,
            since: opts.since ? new Date(opts.since) : undefined,
            until: opts.until ? new Date(opts.until) : undefined,
            noHousekeeping: opts.housekeeping === false,
          },
        });

        spinner.stop();

        const limit = parseInt(opts.limit, 10) || 50;
        const limited = sessions.slice(0, limit);

        if (opts.json) {
          console.log(JSON.stringify(limited, null, 2));
          return;
        }

        if (limited.length === 0) {
          console.log(chalk.yellow('No sessions found.'));
          return;
        }

        console.log(chalk.bold(`\nFound ${sessions.length} session(s)${sessions.length > limit ? `, showing first ${limit}` : ''}\n`));

        // Column widths
        const ID_W = 10;
        const PROV_W = 8;
        const TITLE_W = 40;
        const REPO_W = 18;
        const BRANCH_W = 14;
        const DATE_W = 12;

        console.log(
          chalk.gray(
            padEnd('ID', ID_W) +
            padEnd('Provider', PROV_W) +
            padEnd('Title', TITLE_W) +
            padEnd('Repo', REPO_W) +
            padEnd('Branch', BRANCH_W) +
            'Started'
          )
        );
        console.log(chalk.gray('─'.repeat(ID_W + PROV_W + TITLE_W + REPO_W + BRANCH_W + DATE_W)));

        for (const s of limited) {
          const title = truncate(s.title ?? '(untitled)', TITLE_W - 2);
          const repo = truncate(s.git?.repoName ?? '', REPO_W - 2);
          const branch = truncate(s.git?.branch ?? '', BRANCH_W - 2);
          const date = s.startTime?.toISOString().slice(0, 10) ?? s.endTime?.toISOString().slice(0, 10) ?? '';

          console.log(
            chalk.cyan(padEnd(s.id.slice(0, ID_W - 1), ID_W)) +
            padEnd(s.provider, PROV_W) +
            padEnd(title, TITLE_W) +
            chalk.gray(padEnd(repo, REPO_W)) +
            chalk.gray(padEnd(branch, BRANCH_W)) +
            chalk.gray(date)
          );
        }

        if (sessions.length > limit) {
          console.log(chalk.gray(`\n… ${sessions.length - limit} more sessions. Use --limit to show more.`));
        }

        if (errors.length > 0) {
          console.log(chalk.yellow(`\n${errors.length} file(s) skipped due to errors.`));
        }
      } catch (err) {
        spinner.stop();
        console.error(chalk.red('Error:'), err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });
}

function padEnd(s: string, len: number): string {
  return s.padEnd(len);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}
