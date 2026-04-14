import { existsSync, statSync, readFileSync } from 'fs';
import { join, dirname, basename } from 'path';
import type { GitContext } from './schema.js';

/**
 * Detect git context for a given working directory.
 * Uses pure filesystem reads — no git subprocess — for performance.
 */
export function detectGitContext(cwd: string): GitContext {
  if (!cwd) {
    return emptyContext();
  }

  const repoRoot = findGitRoot(cwd);
  if (!repoRoot) {
    return emptyContext();
  }

  const gitPath = join(repoRoot, '.git');
  const isWorktree = isGitFile(gitPath);
  const worktreeRoot = isWorktree ? resolveWorktreeRoot(gitPath) : null;
  const branch = readBranch(repoRoot);
  const repoName = basename(worktreeRoot ?? repoRoot);

  return {
    repoRoot,
    repoName,
    branch,
    isWorktree,
    worktreeRoot,
  };
}

function emptyContext(): GitContext {
  return {
    repoRoot: null,
    repoName: null,
    branch: null,
    isWorktree: false,
    worktreeRoot: null,
  };
}

/**
 * Walk up the directory tree looking for a .git entry (file or directory).
 * Returns the directory containing .git, or null if not found.
 */
function findGitRoot(dir: string): string | null {
  let current = dir;
  for (;;) {
    const candidate = join(current, '.git');
    if (existsSync(candidate)) return current;
    const parent = dirname(current);
    if (parent === current) return null; // filesystem root
    current = parent;
  }
}

/**
 * A .git entry that is a FILE (not a directory) indicates a linked worktree.
 */
function isGitFile(gitPath: string): boolean {
  try {
    return statSync(gitPath).isFile();
  } catch {
    return false;
  }
}

/**
 * Read the main repo root from a worktree .git file.
 * The .git file contains: "gitdir: /path/to/main/.git/worktrees/<name>"
 * Walk up from that path to find the main repo root.
 */
function resolveWorktreeRoot(gitFilePath: string): string | null {
  try {
    const content = readFileSync(gitFilePath, 'utf8').trim();
    const match = content.match(/^gitdir:\s*(.+)$/m);
    if (!match || !match[1]) return null;
    const gitdirPath = match[1].trim();
    // gitdir points to .git/worktrees/<name> — go up two levels to reach .git,
    // then one more to reach the repo root.
    const repoGitDir = dirname(dirname(gitdirPath));
    const repoRoot = dirname(repoGitDir);
    return existsSync(repoGitDir) ? repoRoot : null;
  } catch {
    return null;
  }
}

/**
 * Read the current branch name from .git/HEAD.
 * Returns branch name, or commit hash prefix for detached HEAD.
 */
function readBranch(repoRoot: string): string | null {
  try {
    const headPath = join(repoRoot, '.git', 'HEAD');
    const content = readFileSync(headPath, 'utf8').trim();
    const refMatch = content.match(/^ref:\s*refs\/heads\/(.+)$/);
    if (refMatch && refMatch[1]) return refMatch[1];
    // Detached HEAD — return short commit hash
    if (/^[0-9a-f]{40}$/i.test(content)) {
      return content.slice(0, 8);
    }
    return content || null;
  } catch {
    return null;
  }
}
