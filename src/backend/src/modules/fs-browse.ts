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