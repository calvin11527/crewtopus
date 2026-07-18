import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  browseDirectory,
  expandUserPath,
  isPathAllowed,
  validateProjectDirectory,
} from '../modules/fs-browse';

describe('fs-browse', () => {
  const testRoot = path.join(os.homedir(), '.agenthub-fs-browse-test');
  const childDir = path.join(testRoot, 'sample-project');

  beforeAll(() => {
    fs.mkdirSync(childDir, { recursive: true });
    fs.writeFileSync(path.join(childDir, 'README.md'), '# test');
  });

  afterAll(() => {
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it('expands tilde paths', () => {
    expect(expandUserPath('~')).toBe(os.homedir());
    expect(expandUserPath('~/Documents')).toBe(path.join(os.homedir(), 'Documents'));
  });

  it('allows paths under the user home directory', () => {
    expect(isPathAllowed(childDir)).toBe(true);
  });

  it('rejects paths outside allowed roots', () => {
    expect(isPathAllowed('/etc/passwd')).toBe(false);
  });

  it('browses a directory and lists child folders', () => {
    const result = browseDirectory(testRoot);
    expect(result.path).toBe(fs.realpathSync(testRoot));
    expect(result.entries.some((entry) => entry.name === 'sample-project')).toBe(true);
  });

  it('validates an existing project directory', () => {
    const result = validateProjectDirectory(childDir);
    expect(result.valid).toBe(true);
    expect(result.name).toBe('sample-project');
    expect(result.isDirectory).toBe(true);
  });
});