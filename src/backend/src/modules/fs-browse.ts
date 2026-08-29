import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveWithinRoot } from '../utils/safe-path';

export interface FsDirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isGitRepo: boolean;
}

export interface FsBrowseResult {
  path: string;
  parent: string | null;
  entries: FsDirectoryEntry[];
  isGitRepo: boolean;
  allowedRoots: string[];
}

export interface FsValidateResult {
  valid: boolean;
  path: string;
  name: string;
  isDirectory: boolean;
  isGitRepo: boolean;
  message?: string;
}

const DENY_PREFIXES = ['/etc', '/private/etc', '/var/root', '/System', '/usr/bin', '/bin', '/sbin'];

/** Expand leading tilde to the user home directory. */
export function expandUserPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return os.homedir();
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

/** Normalize and resolve a path without following symlinks beyond the final segment. */
export function resolveBrowsePath(input: string): string {
  const expanded = expandUserPath(input);
  return path.resolve(expanded);
}

/** Roots the folder browser is allowed to access. */
export function getAllowedRoots(): string[] {
  const roots = [
    os.homedir(),
    process.cwd(),
    process.env.AGENTHUB_WORK_DIR,
    ...(process.env.AGENTHUB_FS_ALLOWLIST?.split(',') ?? []),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => resolveBrowsePath(value));

  return [...new Set(roots)];
}

function realPathSafe(targetPath: string): string {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

function isDeniedSystemPath(targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  return DENY_PREFIXES.some(
    (prefix) => resolved === prefix || resolved.startsWith(`${prefix}${path.sep}`)
  );
}

/** True when target is inside one of the allowed browse roots. */
export function isPathAllowed(targetPath: string): boolean {
  const resolved = resolveBrowsePath(targetPath);
  if (isDeniedSystemPath(resolved)) return false;

  const realTarget = realPathSafe(resolved);
  const roots = getAllowedRoots();

  return roots.some((root) => {
    const realRoot = realPathSafe(root);
    return realTarget === realRoot || realTarget.startsWith(`${realRoot}${path.sep}`);
  });
}

function hasGitRepo(dirPath: string): boolean {
  try {
    return fs.existsSync(resolveWithinRoot(dirPath, '.git'));
  } catch {
    return false;
  }
}

function listChildDirectories(dirPath: string): FsDirectoryEntry[] {
  const entries: FsDirectoryEntry[] = [];

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;

    let fullPath: string;
    try {
      fullPath = resolveWithinRoot(dirPath, entry.name);
    } catch {
      continue;
    }
    if (!isPathAllowed(fullPath)) continue;

    entries.push({
      name: entry.name,
      path: fullPath,
      isDirectory: true,
      isGitRepo: hasGitRepo(fullPath),
    });
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/** List subdirectories under a path for the folder picker UI. */
export function browseDirectory(inputPath?: string): FsBrowseResult {
  const requested = inputPath ? resolveBrowsePath(inputPath) : os.homedir();

  if (!fs.existsSync(requested)) {
    throw new Error(`Path does not exist: ${requested}`);
  }

  const stat = fs.statSync(requested);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${requested}`);
  }

  if (!isPathAllowed(requested)) {
    throw new Error('Path is outside allowed browse roots');
  }

  const resolved = realPathSafe(requested);
  const parentPath = path.dirname(resolved);
  const parent = parentPath !== resolved && isPathAllowed(parentPath) ? parentPath : null;

  return {
    path: resolved,
    parent,
    entries: listChildDirectories(resolved),
    isGitRepo: hasGitRepo(resolved),
    allowedRoots: getAllowedRoots(),
  };
}

/** Validate a folder before linking it to a workspace. */
export function validateProjectDirectory(inputPath: string): FsValidateResult {
  const resolved = resolveBrowsePath(inputPath);
  const name = path.basename(resolved);

  if (!fs.existsSync(resolved)) {
    return { valid: false, path: resolved, name, isDirectory: false, isGitRepo: false, message: 'Path does not exist' };
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    return { valid: false, path: resolved, name, isDirectory: false, isGitRepo: false, message: 'Path is not a directory' };
  }

  if (!isPathAllowed(resolved)) {
    return {
      valid: false,
      path: resolved,
      name,
      isDirectory: true,
      isGitRepo: hasGitRepo(resolved),
      message: 'Path is outside allowed browse roots',
    };
  }

  return {
    valid: true,
    path: realPathSafe(resolved),
    name,
    isDirectory: true,
    isGitRepo: hasGitRepo(resolved),
  };
}

const CORPUS_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.grok',
  '.kiro',
  'dist',
  'build',
  'coverage',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.next',
  '.turbo',
  'target',
  'vendor',
]);

const CORPUS_TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.md',
  '.json',
  '.yml',
  '.yaml',
  '.toml',
  '.css',
  '.html',
  '.txt',
  '.sh',
  '.sql',
  '.rs',
  '.go',
  '.java',
  '.rb',
  '.php',
  '.swift',
  '.kt',
  '.cs',
]);

const MAX_CORPUS_FILES = 500;
const MAX_CORPUS_DEPTH = 8;
const MAX_CORPUS_FILE_BYTES = 80_000;
const MAX_CORPUS_TOTAL_BYTES = 2_500_000;

export interface WorkDirCorpus {
  /** Relative paths (posix-style) found under workDir. */
  files: string[];
  /** Concatenated path names + readable file contents. */
  text: string;
}

function isSafeCorpusSegment(name: string): boolean {
  return (
    Boolean(name) &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('\0') &&
    !name.includes('/') &&
    !name.includes('\\')
  );
}

/**
 * Recursively collect relative file paths and a bounded text corpus.
 * Paths are always resolved from a trusted root (homedir / tmpdir / cwd),
 * then checked with startsWith(root + sep) at the filesystem sink.
 */
export function buildWorkDirCorpus(workDir?: string): WorkDirCorpus {
  if (!workDir) return { files: [], text: '' };

  const homeRoot = path.resolve(os.homedir());
  const tmpRoot = path.resolve(os.tmpdir());
  const cwdRoot = path.resolve(process.cwd());
  const homePrefix = homeRoot + path.sep;
  const tmpPrefix = tmpRoot + path.sep;
  const cwdPrefix = cwdRoot + path.sep;

  const requested = path.resolve(workDir);
  let trustedRoot: string | undefined;
  if (requested === homeRoot || requested.startsWith(homePrefix)) trustedRoot = homeRoot;
  else if (requested === tmpRoot || requested.startsWith(tmpPrefix)) trustedRoot = tmpRoot;
  else if (requested === cwdRoot || requested.startsWith(cwdPrefix)) trustedRoot = cwdRoot;
  if (!trustedRoot) return { files: [], text: '' };

  const fromTrusted = path.relative(trustedRoot, requested);
  const baseSegments = fromTrusted.split(path.sep).filter(Boolean);
  if (baseSegments.some((seg) => !isSafeCorpusSegment(seg))) return { files: [], text: '' };

  const trustedPrefix = trustedRoot + path.sep;
  const files: string[] = [];
  const chunks: string[] = [];
  let totalBytes = 0;
  const queue: Array<{ rel: string; depth: number }> = [{ rel: '', depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (files.length >= MAX_CORPUS_FILES || current.depth > MAX_CORPUS_DEPTH || totalBytes >= MAX_CORPUS_TOTAL_BYTES) {
      continue;
    }

    const childSegments = current.rel.split('/').filter(Boolean);
    if (!childSegments.every(isSafeCorpusSegment)) continue;

    const absDir = path.resolve(trustedRoot, ...baseSegments, ...childSegments);
    if (!absDir.startsWith(trustedPrefix) && absDir !== trustedRoot) continue;

    let entries: fs.Dirent[];
    if (absDir.startsWith(trustedPrefix) || absDir === trustedRoot) {
      try {
        entries = fs.readdirSync(absDir, { withFileTypes: true });
      } catch {
        continue;
      }
    } else {
      continue;
    }

    for (const entry of entries) {
      if (files.length >= MAX_CORPUS_FILES || totalBytes >= MAX_CORPUS_TOTAL_BYTES) break;
      const name = entry.name;
      if (!isSafeCorpusSegment(name) || name.startsWith('._')) continue;
      if (entry.isDirectory()) {
        if (CORPUS_SKIP_DIRS.has(name) || name.startsWith('.')) continue;
        queue.push({ rel: current.rel ? `${current.rel}/${name}` : name, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;

      const rel = current.rel ? `${current.rel}/${name}` : name;
      files.push(rel);

      const ext = path.extname(name).toLowerCase();
      if (!CORPUS_TEXT_EXTENSIONS.has(ext)) continue;

      const relSegments = rel.split('/').filter(Boolean);
      if (!relSegments.every(isSafeCorpusSegment)) continue;

      const full = path.resolve(trustedRoot, ...baseSegments, ...relSegments);
      if (full.startsWith(trustedPrefix)) {
        try {
          const content = fs.readFileSync(full, 'utf-8');
          if (content.length <= 0 || content.length > MAX_CORPUS_FILE_BYTES) continue;
          if (totalBytes + content.length > MAX_CORPUS_TOTAL_BYTES) continue;
          totalBytes += content.length;
          chunks.push(`\n// file: ${rel}\n${content}`);
        } catch {
          /* skip unreadable */
        }
      }
    }
  }

  const pathIndex = files.join('\n');
  return { files, text: `${pathIndex}\n${chunks.join('\n')}` };
}