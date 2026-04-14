import { homedir } from 'os';
import { resolve } from 'path';

/** Expand leading ~ to the home directory. */
export function expandTilde(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return p.replace('~', homedir());
  }
  return p;
}

/** Resolve a path, expanding tilde first. */
export function resolvePath(p: string): string {
  return resolve(expandTilde(p));
}

/**
 * Claude Code encodes project paths by replacing '/' with '-'.
 * e.g. /Users/alex/myproject → -Users-alex-myproject
 * Decode back to an absolute path.
 */
export function decodeClaudioPath(encoded: string): string {
  // The encoded path starts with '-' which was originally '/'
  if (encoded.startsWith('-')) {
    return encoded.replace(/-/g, '/');
  }
  return encoded;
}

/**
 * Convert a string to a URL/file-safe slug.
 * Used for output file naming.
 */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Format a Date as YYYY-MM-DD for file naming. */
export function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Cap a string at maxBytes UTF-8 bytes. */
export function capBytes(s: string, maxBytes: number): string {
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= maxBytes) return s;
  return buf.subarray(0, maxBytes).toString('utf8') + ' [truncated]';
}

/** Replace base64 image data URIs with a placeholder. */
export function redactBase64Images(s: string): string {
  return s.replace(
    /data:image\/[^;]+;base64,[A-Za-z0-9+/=]{100,}/g,
    (match) => {
      const sizeKb = Math.round((match.length * 3) / 4 / 1024);
      return `[image omitted: ~${sizeKb} KB]`;
    }
  );
}
