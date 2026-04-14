import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';

let markedConfigured = false;

function configureMarked(): void {
  if (markedConfigured) return;
  marked.use(
    markedHighlight({
      langPrefix: 'hljs language-',
      highlight(code, lang) {
        const language = hljs.getLanguage(lang) ? lang : 'plaintext';
        return hljs.highlight(code, { language }).value;
      },
    })
  );
  markedConfigured = true;
}

export interface PdfOptions {
  title?: string;
}

/** Convert a Markdown string to PDF at the given output path. */
export async function exportToPdf(
  markdownContent: string,
  outputPath: string,
  options: PdfOptions = {}
): Promise<void> {
  configureMarked();

  const body = await marked.parse(markdownContent);
  const html = wrapInHtmlTemplate(body, options.title ?? 'Session Report');

  // Dynamic import of playwright to avoid crash if not installed
  const { chromium } = await import('playwright');

  mkdirSync(dirname(outputPath), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size:9px;padding-left:15mm;color:#888;font-family:sans-serif">Session Report</div>`,
      footerTemplate: `<div style="font-size:9px;text-align:center;width:100%;color:#888;font-family:sans-serif"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
    });
  } finally {
    await browser.close();
  }
}

/**
 * Batch PDF exporter — reuses a single browser instance for efficiency.
 */
export class PdfExporter {
  private browser: import('playwright').Browser | null = null;

  async open(): Promise<void> {
    const { chromium } = await import('playwright');
    this.browser = await chromium.launch({ headless: true });
  }

  async exportPage(markdownContent: string, outputPath: string, options: PdfOptions = {}): Promise<void> {
    configureMarked();
    if (!this.browser) throw new Error('PdfExporter not opened — call open() first');

    const body = await marked.parse(markdownContent);
    const html = wrapInHtmlTemplate(body, options.title ?? 'Session Report');

    mkdirSync(dirname(outputPath), { recursive: true });

    const page = await this.browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'networkidle' });
      await page.pdf({
        path: outputPath,
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
        displayHeaderFooter: true,
        headerTemplate: `<div style="font-size:9px;padding-left:15mm;color:#888;font-family:sans-serif">${escapeHtml(options.title ?? 'Session Report')}</div>`,
        footerTemplate: `<div style="font-size:9px;text-align:center;width:100%;color:#888;font-family:sans-serif"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
      });
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }
}

// ---- HTML template ----

function wrapInHtmlTemplate(body: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    /* Base typography */
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Georgia, serif;
      font-size: 13px;
      line-height: 1.65;
      color: #1a1a1a;
      max-width: 100%;
      padding: 0;
      margin: 0;
    }
    h1 { font-size: 1.8em; margin-top: 1.5em; border-bottom: 2px solid #e0e0e0; padding-bottom: 0.3em; }
    h2 { font-size: 1.2em; margin-top: 1.5em; color: #2563eb; }
    h3 { font-size: 1em; margin-top: 1.2em; color: #555; }
    p { margin: 0.6em 0; }

    /* Tables */
    table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.9em; }
    th, td { border: 1px solid #d0d0d0; padding: 6px 10px; text-align: left; }
    th { background: #f5f5f5; font-weight: 600; }
    tr:nth-child(even) { background: #fafafa; }

    /* Code */
    code {
      font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 0.88em;
      background: #f4f4f4;
      padding: 2px 5px;
      border-radius: 3px;
    }
    pre {
      background: #f8f8f8;
      border: 1px solid #e0e0e0;
      border-radius: 5px;
      padding: 12px 14px;
      overflow: hidden;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 0.85em;
      line-height: 1.5;
      page-break-inside: avoid;
    }
    pre code { background: none; padding: 0; }

    /* Blockquotes */
    blockquote {
      border-left: 4px solid #d0d0d0;
      padding: 4px 12px;
      margin: 0.8em 0;
      color: #555;
      background: #fafafa;
    }

    /* HR */
    hr { border: none; border-top: 1px solid #e0e0e0; margin: 2em 0; }

    /* Page breaks */
    h1 { page-break-before: auto; page-break-after: avoid; }
    h2, h3 { page-break-after: avoid; }
    pre, table { page-break-inside: avoid; }

    /* Highlight.js GitHub theme (simplified) */
    .hljs { display: block; overflow-x: auto; color: #24292e; }
    .hljs-comment, .hljs-quote { color: #6a737d; }
    .hljs-keyword, .hljs-selector-tag { color: #d73a49; }
    .hljs-string, .hljs-attr { color: #032f62; }
    .hljs-number, .hljs-literal { color: #005cc5; }
    .hljs-title, .hljs-section { color: #6f42c1; }
    .hljs-built_in, .hljs-type { color: #e36209; }
    .hljs-variable { color: #24292e; }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
