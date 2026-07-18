import path from 'path';

const EXCLUDED_CONTEXT_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '__tests__',
  'tests',
  'test',
  '__mocks__',
]);

const EXCLUDED_CONTEXT_FILE = /\.(?:test|spec|stories)\.[tj]sx?$/i;

const EXCLUDED_CONTEXT_FILENAMES = new Set([
  '.DS_Store',
  '.localized',
  'Thumbs.db',
  'desktop.ini',
]);

export const CONTEXT_DIR_EXCLUSIONS = EXCLUDED_CONTEXT_DIRS;

/** Filenames omitted from context (OS metadata, resource forks, test artifacts). */
export function isExcludedContextFilename(filename: string): boolean {
  if (!filename) return true;
  if (EXCLUDED_CONTEXT_FILENAMES.has(filename)) return true;
  if (filename.startsWith('._')) return true;
  return EXCLUDED_CONTEXT_FILE.test(filename);
}

/** Paths omitted from workspace repo context (tests, fixtures with fake secrets, build output). */
export function isExcludedContextPath(relPath: string): boolean {
  const normalized = relPath.split(path.sep).join('/');
  const segments = normalized.split('/');
  if (segments.some((segment) => EXCLUDED_CONTEXT_DIRS.has(segment))) return true;
  const filename = segments[segments.length - 1] || '';
  if (filename === '.env' || filename.startsWith('.env.')) return true;
  return isExcludedContextFilename(filename);
}