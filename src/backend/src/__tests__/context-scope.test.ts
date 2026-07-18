import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ContextScope } from '../types';
import {
  buildContextScope,
  extractSymbols,
  truncateToTokenBudget,
  countScopeTokens,
  hashContext,
  classifySensitivity,
} from '../modules/context-scope';

describe('ContextScope', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-ctx-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should extract TypeScript symbols', () => {
    const content = `
      export function buildScope() {}
      export class ContextBuilder {}
      export interface ScopeConfig {}
    `;
    const symbols = extractSymbols(content, 'scope.ts');
    expect(symbols).toEqual(expect.arrayContaining(['buildScope', 'ContextBuilder', 'ScopeConfig']));
  });

  it('should build context scope from selected files', () => {
    const filePath = path.join(tmpDir, 'sample.ts');
    fs.writeFileSync(filePath, 'export const value = 42;');

    const scope = buildContextScope({
      filePaths: ['sample.ts'],
      basePath: tmpDir,
      includeDiffs: false,
    });

    expect(scope.files).toHaveLength(1);
    expect(scope.files[0]).toContain('sample.ts');
    expect(scope.files[0]).toContain('value = 42');
    expect(scope.symbols).toContain('value');
  });

  it('should not exceed token budget', () => {
    const largeContent = 'x'.repeat(40_000);
    const scope: ContextScope = {
      files: [largeContent, largeContent],
      diffs: [],
      symbols: [],
      maxTokens: 100,
      sensitivityLevel: 0,
    };

    const truncated = truncateToTokenBudget(scope);
    expect(truncated.files).toHaveLength(1);
    expect(truncated.files[0]).toContain('truncated');
    expect(countScopeTokens(truncated)).toBeLessThan(countScopeTokens(scope));
    expect(countScopeTokens(truncated)).toBeLessThan(200);
  });

  it('should produce stable context hashes', () => {
    const scope: ContextScope = {
      files: ['// app.ts\nconst x = 1'],
      diffs: [],
      symbols: ['x'],
      maxTokens: 8000,
      sensitivityLevel: 0,
    };
    expect(hashContext(scope)).toBe(hashContext(scope));
    expect(hashContext(scope)).toHaveLength(16);
  });

  it('should classify sensitivity from file paths', () => {
    const envPath = path.join(tmpDir, '.env');
    fs.writeFileSync(envPath, 'PORT=3000');

    const level = classifySensitivity(['.env'], tmpDir);
    expect(level).toBeGreaterThanOrEqual(2);
  });

  it('should classify sensitivity from detected secrets in content', () => {
    const secretPath = path.join(tmpDir, 'config.ts');
    fs.writeFileSync(secretPath, 'const apiKey = "sk-abcdefghijklmnopqrstuvwxyz123456"');

    const level = classifySensitivity(['config.ts'], tmpDir);
    expect(level).toBe(3);
  });

  it('should skip binary files when building context scope', () => {
    const binaryPath = path.join(tmpDir, 'blob.bin');
    const textPath = path.join(tmpDir, 'readme.md');
    fs.writeFileSync(binaryPath, Buffer.from([0x00, 0x01, 0x42, 0x75, 0x64, 0x31]));
    fs.writeFileSync(textPath, '# Hello');

    const scope = buildContextScope({
      filePaths: ['blob.bin', 'readme.md'],
      basePath: tmpDir,
      includeDiffs: false,
    });

    expect(scope.files).toHaveLength(1);
    expect(scope.files[0]).toContain('readme.md');
    expect(scope.files.join('')).not.toMatch(/\0/);
  });

  it('should not classify routine source code as high sensitivity', () => {
    const sourcePath = path.join(tmpDir, 'auth.ts');
    fs.writeFileSync(
      sourcePath,
      'export function refreshToken(token: string) { return validateSecret(token); }'
    );

    const level = classifySensitivity(['auth.ts'], tmpDir);
    expect(level).toBe(0);
  });
});