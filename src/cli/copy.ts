import { execSync } from 'child_process';
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import type { Provider } from '../schema.js';
import { discoverSessions, parseSessions } from '../discovery.js';
import { sessionToMarkdown, sessionsToMarkdown, DEFAULT_MARKDOWN_OPTIONS } from '../render/markdown.js';
import { parseDateArg } from '../util/paths.js';

const DEFAULT_MAX_CHARS = 80_000;

export function createCopyCommand(): Command {
  return new Command('copy')
    .description('Copy session context to clipboard for pasting into another AI tool')
    .option('-p, --provider <provider...>', 'Filter by provider: claude, codex, cursor, gemini, opencode, copilot')
    .option('--session <id>', 'Copy a specific session by ID prefix')
    .option('--repo <name>', 'Substring match on git repository name')
    .option('--last <n>', 'Number of most recent sessions to include', '1')
    .option('--since <date>', 'Only sessions after this date (ISO 8601)')
    .option('--until <date>', 'Only sessions before this date (ISO 8601)')
    .option('--include-tool-calls', 'Include tool call and result events')
    .option('--include-thinking', 'Include thinking blocks')
    .option('--include-timestamps', 'Prefix events with timestamps')
    .option('--max-chars <n>', `Truncate output to N characters (default: ${DEFAULT_MAX_CHARS})`)
    .option('--max-message-lines <n>', 'Truncate each message after N lines, 0 = unlimited (default: 0)', '0')
    .option('--stdout', 'Print to stdout instead of copying to clipboard')
    .option('--claude-root <path>', 'Override ~/.claude directory')
    .option('--codex-root <path>', 'Override ~/.codex directory')
    .option('--cursor-root <path>', 'Override ~/.cursor directory')
    .option('--gemini-root <path>', 'Override ~/.gemini directory')
    .option('--opencode-root <path>', 'Override ~/.local/share/opencode directory')
    .option('--copilot-root <path>', 'Override ~/.copilot directory')
    .action(async (opts) => {
      const last = Math.max(1, parseInt(opts.last, 10) || 1);
      const maxChars = parseInt(opts.maxChars, 10) || DEFAULT_MAX_CHARS;

      const markdownOpts = {
        ...DEFAULT_MARKDOWN_OPTIONS,
        includeToolCalls: Boolean(opts.includeToolCalls),
        includeThinking: Boolean(opts.includeThinking),
        includeTimestamps: Boolean(opts.includeTimestamps),
        maxMessageLines: parseInt(opts.maxMessageLines, 10) || 0,
      };

      const spinner = ora('Finding sessions…').start();

      try {
        // Step 1: Discover
        const providerFilter = opts.provider as Provider[] | undefined;
        const { sessions: discovered, errors } = await discoverSessions({
          providers: providerFilter,
          claudeRoot: opts.claudeRoot,
          codexRoot: opts.codexRoot,
          cursorRoot: opts.cursorRoot,
          geminiRoot: opts.geminiRoot,
          openCodeRoot: opts.openCodeRoot,
          copilotRoot: opts.copilotRoot,
          filter: {
            provider: providerFilter,
            repo: opts.repo,
            session: opts.session,
            since: opts.since ? parseDateArg(opts.since, '--since') : undefined,
            until: opts.until ? parseDateArg(opts.until, '--until') : undefined,
            noHousekeeping: true,
          },
        });

        if (discovered.length === 0) {
          spinner.stop();
          console.log(chalk.yellow('No sessions found.'));
          return;
        }

        // Take the N most recent
        const toProcess = discovered.slice(0, last);
        spinner.text = `Parsing ${toProcess.length} session(s)…`;

        // Step 2: Full parse
        const { sessions } = await parseSessions(toProcess);

        if (sessions.length === 0) {
          spinner.stop();
          console.log(chalk.yellow('No sessions could be parsed.'));
          return;
        }

        spinner.text = 'Rendering…';

        // Step 3: Render to markdown with a context-handoff preamble
        const preamble = buildPreamble(sessions.map((s) => s.provider), sessions[0]?.title ?? null);
        let body: string;
        if (sessions.length === 1) {
          body = sessionToMarkdown(sessions[0]!, markdownOpts);
        } else {
          body = sessionsToMarkdown(sessions, markdownOpts);
        }

        let output = `${preamble}\n\n---\n\n${body}`;

        // Step 4: Truncate from the front if too long (keep the most recent context)
        if (output.length > maxChars) {
          const truncated = output.slice(output.length - maxChars);
          // Find the first newline so we don't start mid-line
          const firstNewline = truncated.indexOf('\n');
          output = `> *(context truncated to last ${maxChars.toLocaleString()} characters)*\n\n` +
            (firstNewline >= 0 ? truncated.slice(firstNewline + 1) : truncated);
        }

        spinner.stop();

        if (opts.stdout) {
          process.stdout.write(output);
          return;
        }

        // Step 5: Copy to clipboard
        const copied = copyToClipboard(output);

        if (copied) {
          const charCount = output.length.toLocaleString();
          const sessionWord = sessions.length === 1 ? 'session' : 'sessions';
          console.log(chalk.green(`\nCopied ${sessions.length} ${sessionWord} (${charCount} chars) to clipboard.`));
          console.log(chalk.gray('Paste it into any AI tool to continue your work.\n'));

          // Print a short summary of what was copied
          for (const s of sessions) {
            const title = s.title ?? '(untitled)';
            const date = s.startTime?.toISOString().slice(0, 10) ?? s.endTime?.toISOString().slice(0, 10) ?? '';
            const events = s.eventCount;
            console.log(`  ${chalk.cyan(s.provider.padEnd(10))} ${chalk.white(title.slice(0, 50).padEnd(52))} ${chalk.gray(date)} ${chalk.gray(`${events} events`)}`);
          }

          if (errors.length > 0) {
            console.log(chalk.yellow(`\n${errors.length} file(s) skipped due to errors.`));
          }
        } else {
          // Clipboard not available — fall back to stdout
          console.error(chalk.yellow('Could not access clipboard. Printing to stdout instead.\n'));
          process.stdout.write(output);
        }

      } catch (err) {
        spinner.stop();
        console.error(chalk.red('Error:'), err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });
}

// ---- Helpers ----

function buildPreamble(providers: string[], title: string | null): string {
  const providerList = [...new Set(providers)].join(', ');
  const titleLine = title ? `**Session:** ${title}\n> ` : '';
  return [
    '> **AI Coding Session Context**',
    `> ${titleLine}**Tool:** ${providerList}`,
    '>',
    '> I was working on this project and need to continue in a new context.',
    '> Below is the full session transcript. Please read it and help me continue.',
  ].join('\n');
}

function copyToClipboard(text: string): boolean {
  try {
    if (process.platform === 'darwin') {
      execSync('pbcopy', { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
      return true;
    }
    if (process.platform === 'linux') {
      try {
        execSync('xclip -selection clipboard', { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
        return true;
      } catch {
        execSync('xsel --clipboard --input', { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
        return true;
      }
    }
    if (process.platform === 'win32') {
      execSync('clip', { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
      return true;
    }
  } catch { /* fall through */ }
  return false;
}
