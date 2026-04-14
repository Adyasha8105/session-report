import { mkdirSync } from 'fs';
import { join } from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import type { Provider, ExportFormat, ExportMode, Session } from '../schema.js';
import { discoverSessions, parseSessions } from '../discovery.js';
import { sessionToMarkdown, sessionsToMarkdown, DEFAULT_MARKDOWN_OPTIONS } from '../render/markdown.js';
import { exportToPdf, PdfExporter } from '../export/pdf.js';
import { exportToDocx } from '../export/docx.js';
import { slugify, formatDate, parseDateArg } from '../util/paths.js';

export function createExportCommand(): Command {
  return new Command('export')
    .description('Export sessions to PDF or DOCX')
    .option('--format <format>', 'Output format: pdf or docx', 'docx')
    .option('--mode <mode>', 'Export mode: single | combined | split-provider | split-repo', 'combined')
    .option('--output <dir>', 'Output directory', './session-reports')
    .option('-p, --provider <provider...>', 'Filter by provider: claude, codex, cursor, gemini, opencode, copilot')
    .option('--repo <name>', 'Substring match on git repository name')
    .option('--worktree', 'Only include worktree sessions')
    .option('--session <id>', 'Export a single session by ID prefix')
    .option('--since <date>', 'Only sessions after this date (ISO 8601)')
    .option('--until <date>', 'Only sessions before this date (ISO 8601)')
    .option('--include-tool-calls', 'Include tool call and result events')
    .option('--include-meta', 'Include system/meta events')
    .option('--include-thinking', 'Include thinking blocks')
    .option('--include-timestamps', 'Prefix events with timestamps')
    .option('--max-tool-lines <n>', 'Max lines of tool output to include', '50')
    .option('--max-message-lines <n>', 'Truncate each message after N lines, 0 = unlimited (default: 0)', '0')
    .option('--no-housekeeping', 'Exclude sessions with no assistant output')
    .option('--claude-root <path>', 'Override ~/.claude directory')
    .option('--codex-root <path>', 'Override ~/.codex directory')
    .option('--cursor-root <path>', 'Override ~/.cursor directory')
    .option('--gemini-root <path>', 'Override ~/.gemini directory')
    .option('--opencode-root <path>', 'Override ~/.local/share/opencode directory')
    .option('--copilot-root <path>', 'Override ~/.copilot directory')
    .action(async (opts) => {
      const format = opts.format as ExportFormat;
      const mode = opts.mode as ExportMode;

      if (!['pdf', 'docx'].includes(format)) {
        console.error(chalk.red(`Unknown format: ${format}. Use pdf or docx.`));
        process.exit(1);
      }
      if (!['single', 'combined', 'split-provider', 'split-repo'].includes(mode)) {
        console.error(chalk.red(`Unknown mode: ${mode}. Use single, combined, split-provider, or split-repo.`));
        process.exit(1);
      }

      const markdownOpts = {
        ...DEFAULT_MARKDOWN_OPTIONS,
        includeToolCalls: Boolean(opts.includeToolCalls),
        includeMetaEvents: Boolean(opts.includeMeta),
        includeThinking: Boolean(opts.includeThinking),
        includeTimestamps: Boolean(opts.includeTimestamps),
        maxToolOutputLines: parseInt(opts.maxToolLines, 10) || 50,
        maxMessageLines: parseInt(opts.maxMessageLines, 10) || 0,
      };

      const spinner = ora('Scanning sessions…').start();

      try {
        // Step 1: Discover
        const providerFilter = opts.provider as Provider[] | undefined;
        const { sessions: discovered, errors: scanErrors } = await discoverSessions({
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
            worktree: opts.worktree,
            session: opts.session,
            since: opts.since ? parseDateArg(opts.since, '--since') : undefined,
            until: opts.until ? parseDateArg(opts.until, '--until') : undefined,
            noHousekeeping: opts.housekeeping === false,
          },
        });

        if (discovered.length === 0) {
          spinner.stop();
          console.log(chalk.yellow('No sessions found matching the given filters.'));
          return;
        }

        spinner.text = `Parsing ${discovered.length} session(s)…`;

        // Step 2: Full parse
        const { sessions, errors: parseErrors } = await parseSessions(discovered);
        const allErrors = [...scanErrors, ...parseErrors];

        spinner.text = 'Rendering…';

        // Step 3: Export
        mkdirSync(opts.output, { recursive: true });
        const outputFiles: string[] = [];

        if (mode === 'combined') {
          const md = sessionsToMarkdown(sessions, markdownOpts);
          const filename = `combined-${formatDate(new Date())}.${format}`;
          const outPath = join(opts.output, filename);
          await exportDocument(md, outPath, format, 'Session Report');
          outputFiles.push(outPath);

        } else if (mode === 'single') {
          const exporter = format === 'pdf' ? new PdfExporter() : null;
          if (exporter) await exporter.open();
          try {
            for (const session of sessions) {
              const title = session.title ?? 'untitled';
              const slug = slugify(title);
              const filename = `${session.provider}-${session.id.slice(0, 8)}-${slug}.${format}`;
              const outPath = join(opts.output, filename);
              const md = sessionToMarkdown(session, markdownOpts);
              if (exporter) {
                await exporter.exportPage(md, outPath, { title: session.title ?? undefined });
              } else {
                await exportToDocx(md, outPath);
              }
              outputFiles.push(outPath);
            }
          } finally {
            if (exporter) await exporter.close();
          }

        } else if (mode === 'split-provider') {
          const byProvider = groupBy(sessions, (s) => s.provider);
          for (const [provider, group] of byProvider) {
            const md = sessionsToMarkdown(group, markdownOpts);
            const filename = `${provider}-sessions-${formatDate(new Date())}.${format}`;
            const outPath = join(opts.output, filename);
            await exportDocument(md, outPath, format, `${provider} Sessions`);
            outputFiles.push(outPath);
          }

        } else if (mode === 'split-repo') {
          const byRepo = groupBy(sessions, (s) => s.git?.repoName ?? 'unknown-repo');
          for (const [repo, group] of byRepo) {
            const md = sessionsToMarkdown(group, markdownOpts);
            const slug = slugify(repo);
            const filename = `${slug}-sessions-${formatDate(new Date())}.${format}`;
            const outPath = join(opts.output, filename);
            await exportDocument(md, outPath, format, `${repo} Sessions`);
            outputFiles.push(outPath);
          }
        }

        spinner.stop();

        console.log(chalk.green(`\nExported ${outputFiles.length} file(s):`));
        for (const f of outputFiles) {
          console.log(`  ${chalk.cyan(f)}`);
        }

        if (allErrors.length > 0) {
          console.log(chalk.yellow(`\n${allErrors.length} file(s) had errors and were skipped.`));
        }

      } catch (err) {
        spinner.stop();
        console.error(chalk.red('Export failed:'), err instanceof Error ? err.message : err);
        process.exit(1);
      }
    });
}

async function exportDocument(
  md: string,
  outputPath: string,
  format: ExportFormat,
  title: string
): Promise<void> {
  if (format === 'pdf') {
    await exportToPdf(md, outputPath, { title });
  } else {
    await exportToDocx(md, outputPath);
  }
}

function groupBy<T>(arr: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of arr) {
    const k = key(item);
    const group = map.get(k) ?? [];
    group.push(item);
    map.set(k, group);
  }
  return map;
}
