import { createWriteStream, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { Token, Tokens, TokensList } from 'marked';
import { marked } from 'marked';
import PDFDocument from 'pdfkit';

// Built-in pdfkit fonts — no external files needed
const F = {
  regular:    'Helvetica',
  bold:       'Helvetica-Bold',
  italic:     'Helvetica-Oblique',
  boldItalic: 'Helvetica-BoldOblique',
  mono:       'Courier',
};

const C = {
  text:        '#1A1A1A',
  muted:       '#666666',
  heading1:    '#111111',
  heading2:    '#1F2937',
  heading3:    '#374151',
  codeBg:      '#F5F5F5',
  codeText:    '#333333',
  codeBar:     '#D1D5DB',
  border:      '#E5E7EB',
  tableHeader: '#F3F4F6',
  hrLine:      '#E5E7EB',
  blockquote:  '#6B7280',
  bqBar:       '#D1D5DB',
  link:        '#2563EB',
};

/** Convert a Markdown string to a PDF file at the given output path. */
export async function exportToPdf(
  markdownContent: string,
  outputPath: string,
  options?: { title?: string }
): Promise<void> {
  mkdirSync(dirname(outputPath), { recursive: true });

  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 60, bottom: 72, left: 72, right: 72 },
    info: {
      Title: options?.title ?? 'Session Report',
      Creator: 'session-report',
    },
    autoFirstPage: true,
    bufferPages: true,
  });

  const stream = createWriteStream(outputPath);
  doc.pipe(stream);

  const tokens = marked.lexer(markdownContent);
  renderTokenList(doc, tokens);

  // Add page numbers to all pages
  const range = (doc as unknown as { bufferedPageRange(): { start: number; count: number } }).bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc
      .font(F.regular)
      .fontSize(8)
      .fillColor(C.muted)
      .text(`${i + 1} / ${range.count}`, 0, doc.page.height - 40, {
        width: doc.page.width,
        align: 'center',
        lineBreak: false,
      });
  }

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

/** Batch exporter — thin wrapper kept for CLI export.ts compatibility. */
export class PdfExporter {
  async open(): Promise<void> {}
  async close(): Promise<void> {}

  async exportPage(
    markdown: string,
    outputPath: string,
    options?: { title?: string }
  ): Promise<void> {
    return exportToPdf(markdown, outputPath, options);
  }
}

// ---- Token rendering ----

function renderTokenList(doc: PDFKit.PDFDocument, tokens: TokensList | Token[]): void {
  for (const token of tokens) renderToken(doc, token);
}

function renderToken(doc: PDFKit.PDFDocument, token: Token): void {
  switch (token.type) {
    case 'heading':    return renderHeading(doc, token as Tokens.Heading);
    case 'paragraph':  return renderParagraph(doc, token as Tokens.Paragraph);
    case 'code':       return renderCode(doc, token as Tokens.Code);
    case 'blockquote': return renderBlockquote(doc, token as Tokens.Blockquote);
    case 'list':       return renderList(doc, token as Tokens.List);
    case 'table':      return renderTable(doc, token as Tokens.Table);
    case 'hr':         return renderHr(doc);
    case 'space':      doc.moveDown(0.3); break;
  }
}

function renderHeading(doc: PDFKit.PDFDocument, token: Tokens.Heading): void {
  const cfg: Record<number, { size: number; color: string; before: number }> = {
    1: { size: 22, color: C.heading1, before: 1.2 },
    2: { size: 16, color: C.heading2, before: 0.9 },
    3: { size: 13, color: C.heading3, before: 0.5 },
    4: { size: 11, color: C.heading3, before: 0.3 },
    5: { size: 10, color: C.muted,    before: 0.2 },
    6: { size: 9,  color: C.muted,    before: 0.2 },
  };
  const { size, color, before } = cfg[token.depth] ?? cfg[3]!;
  doc.moveDown(before);
  doc.font(F.bold).fontSize(size).fillColor(color).text(stripInlineMarkdown(token.text));
  doc.moveDown(0.15);
  doc.font(F.regular).fontSize(10).fillColor(C.text);
}

function renderParagraph(doc: PDFKit.PDFDocument, token: Tokens.Paragraph): void {
  doc.moveDown(0.15);
  renderInlineTokens(doc, token.tokens ?? [{ type: 'text', text: token.text, raw: token.text }]);
  doc.moveDown(0.25);
}

function renderCode(doc: PDFKit.PDFDocument, token: Tokens.Code): void {
  const lines = token.text.split('\n');
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const padding = 8;
  const lineH = 12;
  const blockH = lines.length * lineH + padding * 2;

  doc.moveDown(0.4);
  const x = doc.page.margins.left;
  const y = doc.y;

  doc.rect(x, y, pageWidth, blockH).fill(C.codeBg);
  doc.rect(x, y, 3, blockH).fill(C.codeBar);

  doc.font(F.mono).fontSize(8).fillColor(C.codeText);
  for (let i = 0; i < lines.length; i++) {
    doc.text(lines[i] || ' ', x + padding + 3, y + padding + i * lineH, {
      width: pageWidth - padding * 2 - 6,
      lineBreak: false,
    });
  }

  doc.y = y + blockH;
  doc.moveDown(0.4);
  doc.font(F.regular).fontSize(10).fillColor(C.text);
}

function renderBlockquote(doc: PDFKit.PDFDocument, token: Tokens.Blockquote): void {
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const text = stripInlineMarkdown(token.text);
  const textH = doc.font(F.italic).fontSize(10).heightOfString(text, { width: pageWidth - 20 });

  doc.moveDown(0.3);
  const x = doc.page.margins.left;
  const y = doc.y;

  doc.rect(x, y, 3, textH + 8).fill(C.bqBar);
  doc.font(F.italic).fontSize(10).fillColor(C.blockquote)
    .text(text, x + 14, y + 4, { width: pageWidth - 18 });

  doc.moveDown(0.3);
  doc.font(F.regular).fillColor(C.text);
}

function renderList(doc: PDFKit.PDFDocument, token: Tokens.List): void {
  doc.moveDown(0.2);
  token.items.forEach((item: Tokens.ListItem, index: number) => {
    const bullet = token.ordered ? `${index + 1}.` : '•';
    doc.font(F.regular).fontSize(10).fillColor(C.text)
      .text(`${bullet}  ${stripInlineMarkdown(item.text)}`, { indent: 16, lineBreak: true });
    doc.moveDown(0.1);
  });
  doc.moveDown(0.2);
}

function renderTable(doc: PDFKit.PDFDocument, token: Tokens.Table): void {
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const startX = doc.page.margins.left;
  const numCols = token.header.length;
  const padding = 6;
  const fontSize = 9;

  const colWidths: number[] = numCols === 2
    ? [Math.round(pageWidth * 0.30), Math.round(pageWidth * 0.70)]
    : Array<number>(numCols).fill(Math.round(pageWidth / numCols));

  doc.moveDown(0.4);

  const drawRow = (cells: Array<{ text: string }>, y: number, isHeader: boolean): number => {
    let rowH = 0;
    cells.forEach((cell, i) => {
      const h = doc
        .font(isHeader ? F.bold : F.regular)
        .fontSize(fontSize)
        .heightOfString(stripInlineMarkdown(cell.text), { width: colWidths[i]! - padding * 2 });
      if (h > rowH) rowH = h;
    });
    rowH += padding * 2;

    if (isHeader) doc.rect(startX, y, pageWidth, rowH).fill(C.tableHeader);

    let x = startX;
    cells.forEach((cell, i) => {
      doc.rect(x, y, colWidths[i]!, rowH).stroke(C.border);
      doc
        .font(isHeader ? F.bold : F.regular)
        .fontSize(fontSize)
        .fillColor(isHeader ? C.heading2 : C.text)
        .text(stripInlineMarkdown(cell.text), x + padding, y + padding, {
          width: colWidths[i]! - padding * 2,
          lineBreak: true,
        });
      x += colWidths[i]!;
    });

    return y + rowH;
  };

  let y = doc.y;
  y = drawRow(token.header, y, true);
  for (const row of token.rows) {
    y = drawRow(row, y, false);
  }

  doc.y = y;
  doc.moveDown(0.4);
  doc.font(F.regular).fontSize(10).fillColor(C.text);
}

function renderHr(doc: PDFKit.PDFDocument): void {
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.moveDown(0.5);
  doc
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.margins.left + pageWidth, doc.y)
    .lineWidth(0.5)
    .stroke(C.hrLine);
  doc.moveDown(0.5);
}

// ---- Inline token rendering ----

function renderInlineTokens(doc: PDFKit.PDFDocument, tokens: Token[]): void {
  type Seg = { text: string; bold?: boolean; italic?: boolean; mono?: boolean; link?: boolean };
  const segs: Seg[] = [];

  for (const t of tokens) {
    if (t.type === 'text')     segs.push({ text: (t as Tokens.Text).text });
    else if (t.type === 'strong')   segs.push({ text: stripInlineMarkdown((t as Tokens.Strong).text), bold: true });
    else if (t.type === 'em')       segs.push({ text: stripInlineMarkdown((t as Tokens.Em).text), italic: true });
    else if (t.type === 'codespan') segs.push({ text: (t as Tokens.Codespan).text, mono: true });
    else if (t.type === 'link')     segs.push({ text: (t as Tokens.Link).text || (t as Tokens.Link).href, link: true });
    else if (t.type === 'br')       segs.push({ text: '\n' });
  }

  if (segs.length === 0) return;

  if (segs.every((s) => !s.bold && !s.italic && !s.mono && !s.link)) {
    doc.font(F.regular).fontSize(10).fillColor(C.text).text(segs.map((s) => s.text).join(''));
    return;
  }

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  segs.forEach((seg, i) => {
    const isLast = i === segs.length - 1;
    const font  = seg.mono ? F.mono
                : (seg.bold && seg.italic) ? F.boldItalic
                : seg.bold   ? F.bold
                : seg.italic ? F.italic
                : F.regular;
    const color = seg.link ? C.link : seg.mono ? C.codeText : C.text;
    const size  = seg.mono ? 9 : 10;

    doc.font(font).fontSize(size).fillColor(color).text(seg.text, {
      continued: !isLast,
      width: pageWidth,
      lineBreak: true,
    });
  });
}

function stripInlineMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/\\([[\]`*_{}()#+\-.!])/g, '$1');
}
