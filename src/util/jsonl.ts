import { createReadStream } from 'fs';
import { createInterface } from 'readline';

export interface JsonlReadOptions {
  /** Stop after reading this many lines. */
  maxLines?: number;
  /** Skip lines that fail JSON.parse (default: true). */
  skipMalformed?: boolean;
}

/**
 * Async generator that yields parsed JSON objects from a JSONL file,
 * one line at a time. Never loads the entire file into memory.
 */
export async function* readJsonlFile(
  filePath: string,
  options: JsonlReadOptions = {}
): AsyncGenerator<unknown> {
  const { maxLines, skipMalformed = true } = options;
  let lineCount = 0;

  const stream = createReadStream(filePath, {
    encoding: 'utf8',
    highWaterMark: 65536,
  });

  const rl = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed: unknown = JSON.parse(trimmed);
        yield parsed;
      } catch {
        if (!skipMalformed) {
          throw new Error(`Malformed JSON on line ${lineCount + 1} in ${filePath}`);
        }
        // Skip malformed lines silently
        continue;
      }

      lineCount++;
      if (maxLines !== undefined && lineCount >= maxLines) {
        break;
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}

/**
 * Collect all records from a JSONL file into an array.
 * Only use for small files — use readJsonlFile for large ones.
 */
export async function readJsonlAll(
  filePath: string,
  options: JsonlReadOptions = {}
): Promise<unknown[]> {
  const results: unknown[] = [];
  for await (const record of readJsonlFile(filePath, options)) {
    results.push(record);
  }
  return results;
}
