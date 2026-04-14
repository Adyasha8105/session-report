import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { Token, Tokens, TokensList } from 'marked';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  BorderStyle,
  ShadingType,
  WidthType,
  TableLayoutType,
} from 'docx';
import { marked } from 'marked';

/** Convert a Markdown string to a DOCX file at the given output path. */
export async function exportToDocx(
  markdownContent: string,
  outputPath: string
): Promise<void> {
  const tokens = marked.lexer(markdownContent);
  const children = tokensToDocxElements(tokens);

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
          },
        },
        children,
      },
    ],
    styles: {
      paragraphStyles: [
        {
          id: 'CodeBlock',
          name: 'Code Block',
          basedOn: 'Normal',
          run: {
            font: { name: 'Courier New' },
            size: 18, // 9pt
          },
          paragraph: {
            spacing: { before: 120, after: 120 },
          },
        },
      ],
    },
  });

  const buffer = await Packer.toBuffer(doc);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, buffer);
}

// ---- Token → docx element mapping ----

type DocxElement = Paragraph | Table;

function tokensToDocxElements(tokens: TokensList | Token[]): DocxElement[] {
  const elements: DocxElement[] = [];

  for (const token of tokens) {
    const els = tokenToElements(token);
    elements.push(...els);
  }

  return elements;
}

function tokenToElements(token: Token): DocxElement[] {
  switch (token.type) {
    case 'heading':
      return [headingToDocx(token as Tokens.Heading)];
    case 'paragraph':
      return [paragraphToDocx(token as Tokens.Paragraph)];
    case 'code':
      return codeBlockToDocx(token as Tokens.Code);
    case 'blockquote':
      return blockquoteToDocx(token as Tokens.Blockquote);
    case 'list':
      return listToDocx(token as Tokens.List);
    case 'table':
      return [tableToDocx(token as Tokens.Table)];
    case 'hr':
      return [hrToDocx()];
    case 'space':
      return [new Paragraph({ text: '', spacing: { before: 80, after: 80 } })];
    default:
      return [];
  }
}

function headingToDocx(token: Tokens.Heading): Paragraph {
  const levelMap: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
    4: HeadingLevel.HEADING_4,
    5: HeadingLevel.HEADING_5,
    6: HeadingLevel.HEADING_6,
  };
  return new Paragraph({
    text: stripInlineMarkdown(token.text),
    heading: levelMap[token.depth] ?? HeadingLevel.HEADING_3,
    spacing: { before: 240, after: 120 },
  });
}

function paragraphToDocx(token: Tokens.Paragraph): Paragraph {
  const runs = inlineTokensToRuns(token.tokens ?? []);
  return new Paragraph({
    children: runs.length > 0 ? runs : [new TextRun(token.text)],
    spacing: { before: 80, after: 80 },
  });
}

function codeBlockToDocx(token: Tokens.Code): DocxElement[] {
  const lines = token.text.split('\n');

  // Build one paragraph with all lines joined by explicit line-breaks.
  // A single paragraph with four-sided borders renders as a cohesive code block.
  const runs: TextRun[] = [];
  lines.forEach((line, i) => {
    runs.push(
      new TextRun({
        text: line || '\u00A0', // non-breaking space keeps empty lines visible
        font: { name: 'Courier New' },
        size: 18,
        color: '333333',
      })
    );
    if (i < lines.length - 1) {
      runs.push(new TextRun({ break: 1 }));
    }
  });

  return [
    new Paragraph({
      children: runs,
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F4F4F4' },
      border: {
        top:    { style: BorderStyle.SINGLE, size: 4,  color: 'D1D5DB', space: 4 },
        bottom: { style: BorderStyle.SINGLE, size: 4,  color: 'D1D5DB', space: 4 },
        left:   { style: BorderStyle.THICK,  size: 16, color: '6366F1', space: 6 },
        right:  { style: BorderStyle.SINGLE, size: 4,  color: 'D1D5DB', space: 4 },
      },
      spacing: { before: 160, after: 160, line: 260 },
      indent: { left: 240, right: 240 },
    }),
  ];
}

function blockquoteToDocx(token: Tokens.Blockquote): DocxElement[] {
  const text = stripInlineMarkdown(token.text);
  return [
    new Paragraph({
      children: [new TextRun({ text, italics: true, color: '555555' })],
      indent: { left: 720 },
      border: {
        left: { style: BorderStyle.SINGLE, size: 12, color: 'CCCCCC', space: 8 },
      },
      spacing: { before: 120, after: 120 },
    }),
  ];
}

function listToDocx(token: Tokens.List): DocxElement[] {
  return token.items.map(
    (item: Tokens.ListItem, index: number) =>
      new Paragraph({
        children: [
          new TextRun(
            token.ordered ? `${index + 1}. ${stripInlineMarkdown(item.text)}` : `• ${stripInlineMarkdown(item.text)}`
          ),
        ],
        spacing: { before: 40, after: 40 },
        indent: { left: 360 },
      })
  );
}

function tableToDocx(token: Tokens.Table): Table {
  const rows: TableRow[] = [];

  // Header row
  rows.push(
    new TableRow({
      children: token.header.map(
        (cell: Tokens.TableCell) =>
          new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text: stripInlineMarkdown(cell.text), bold: true })],
              }),
            ],
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F0F0F0' },
          })
      ),
      tableHeader: true,
    })
  );

  // Data rows
  for (const row of token.rows) {
    rows.push(
      new TableRow({
        children: row.map(
          (cell: Tokens.TableCell) =>
            new TableCell({
              children: [
                new Paragraph({ text: stripInlineMarkdown(cell.text) }),
              ],
            })
        ),
      })
    );
  }

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
  });
}

function hrToDocx(): Paragraph {
  return new Paragraph({
    text: '',
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: 'E0E0E0', space: 4 },
    },
    spacing: { before: 200, after: 200 },
  });
}

// ---- Inline token rendering ----

function inlineTokensToRuns(tokens: Token[]): TextRun[] {
  const runs: TextRun[] = [];
  for (const token of tokens) {
    if (token.type === 'text') {
      runs.push(new TextRun(token.text));
    } else if (token.type === 'strong') {
      runs.push(new TextRun({ text: stripInlineMarkdown(token.text), bold: true }));
    } else if (token.type === 'em') {
      runs.push(new TextRun({ text: stripInlineMarkdown(token.text), italics: true }));
    } else if (token.type === 'codespan') {
      runs.push(
        new TextRun({
          text: token.text,
          font: { name: 'Courier New' },
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F4F4F4' },
        })
      );
    } else if (token.type === 'link') {
      runs.push(new TextRun({ text: stripInlineMarkdown(token.text), color: '2563EB' }));
    } else if (token.type === 'br') {
      runs.push(new TextRun({ text: '', break: 1 }));
    }
  }
  return runs;
}

/** Strip common inline markdown for plain text contexts. */
function stripInlineMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/\\([[\]`*_{}()#+\-.!])/g, '$1');
}
