import fs from 'fs';
import os from 'os';
import path from 'path';
import { createWorkspace, addRepository } from '../modules/workspace';
import { createWorkItem } from '../modules/work-items';
import {
  buildWorkItemContextScope,
  collectRepoContextFiles,
  listWorkDirFilePaths,
  matchContextGlob,
  resolveWorkItemContextPaths,
  resolveWorkItemWorkDir,
} from '../modules/work-item-context';
import { runPrivacyGuard } from '../modules/privacy-guard';

describe('Work Item Context (M3)', () => {
  it('should match simple context globs', () => {
    expect(matchContextGlob('app.ts', '*.ts')).toBe(true);
    expect(matchContextGlob('app.ts', '*.md')).toBe(false);
    expect(matchContextGlob('readme.md', '**/*.md')).toBe(true);
  });

  it('should include work directory files in context scope', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-ctx-'));
    const filePath = path.join(tmpDir, 'improvements.md');
    fs.writeFileSync(filePath, '# Improvements\n- item one');

    const item = createWorkItem({ type: 'task', title: 'Context test', assignedAgentType: 'mock' });
    const { scope, auditFilePaths } = buildWorkItemContextScope(item, tmpDir);

    expect(listWorkDirFilePaths(tmpDir)).toContain(filePath);
    expect(scope.files.some((f) => f.includes('improvements.md'))).toBe(true);
    expect(auditFilePaths).toContain('improvements.md');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should prefer workspace primary repo over AGENTHUB_WORK_DIR for work directory', () => {
    const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-scratch-'));
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-repo-focus-'));
    const previousWorkDir = process.env.AGENTHUB_WORK_DIR;
    process.env.AGENTHUB_WORK_DIR = scratchDir;

    const workspace = createWorkspace('AgentHub');
    addRepository(workspace.id, 'AgentHub', repoDir);

    const item = createWorkItem({
      type: 'story',
      title: 'Focused repo',
      workspaceId: workspace.id,
      assignedAgentType: 'grok',
    });

    expect(resolveWorkItemWorkDir(item)).toBe(repoDir);

    const { basePath } = resolveWorkItemContextPaths(item, resolveWorkItemWorkDir(item));
    expect(basePath).toBe(repoDir);

    if (previousWorkDir === undefined) delete process.env.AGENTHUB_WORK_DIR;
    else process.env.AGENTHUB_WORK_DIR = previousWorkDir;

    fs.rmSync(scratchDir, { recursive: true, force: true });
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('should include workspace repo files when workspace is linked', () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-repo-'));
    fs.writeFileSync(path.join(repoDir, 'package.json'), '{"name":"demo"}');
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# Demo');

    const workspace = createWorkspace('Test WS', undefined, {
      contextGlobs: ['*.json', '*.md'],
      contextMaxFiles: 10,
    });
    addRepository(workspace.id, 'demo', repoDir);

    const item = createWorkItem({
      type: 'task',
      title: 'Repo context',
      workspaceId: workspace.id,
      assignedAgentType: 'mock',
    });

    const { filePaths } = buildWorkItemContextScope(item);
    expect(filePaths.some((f) => f.endsWith('package.json'))).toBe(true);
    expect(filePaths.some((f) => f.endsWith('README.md'))).toBe(true);
    expect(collectRepoContextFiles(repoDir, ['*.json'], 5)).toHaveLength(1);

    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('should exclude dotfiles like .DS_Store from work directory context', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-ds-'));
    fs.writeFileSync(path.join(tmpDir, 'notes.md'), '# Notes');
    fs.writeFileSync(path.join(tmpDir, '.DS_Store'), Buffer.from([0, 0, 0, 1, 0x42, 0x75, 0x64, 0x31]));

    expect(listWorkDirFilePaths(tmpDir).some((f) => f.endsWith('.DS_Store'))).toBe(false);
    expect(listWorkDirFilePaths(tmpDir).some((f) => f.endsWith('notes.md'))).toBe(true);

    const item = createWorkItem({ type: 'task', title: 'DS_Store test', assignedAgentType: 'grok' });
    const { scope } = buildWorkItemContextScope(item, tmpDir);
    expect(scope.files.some((f) => f.includes('.DS_Store'))).toBe(false);
    expect(scope.files.some((f) => f.includes('notes.md'))).toBe(true);
    expect(scope.files.join('')).not.toMatch(/\0/);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should exclude test directories from workspace repo context', () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-repo-tests-'));
    fs.mkdirSync(path.join(repoDir, 'src'));
    fs.mkdirSync(path.join(repoDir, 'src', '__tests__'));
    fs.writeFileSync(path.join(repoDir, 'src', 'app.ts'), 'export const app = 1;');
    fs.writeFileSync(
      path.join(repoDir, 'src', '__tests__', 'app.test.ts'),
      'const apiKey = "sk-abcdefghijklmnopqrstuvwxyz123456";'
    );

    const collected = collectRepoContextFiles(repoDir, ['*.ts'], 10);
    expect(collected.some((f) => f.endsWith('app.ts'))).toBe(true);
    expect(collected.some((f) => f.endsWith('app.test.ts'))).toBe(false);
    expect(collected.some((f) => f.includes('__tests__'))).toBe(false);

    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('should allow grok on workspace repo context without false high sensitivity', () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-repo-grok-'));
    fs.writeFileSync(
      path.join(repoDir, 'auth.ts'),
      'export function refreshToken(token: string) { return token; }'
    );
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# Demo project');

    const workspace = createWorkspace('Grok WS', undefined, {
      contextGlobs: ['*.ts', '*.md'],
      contextMaxFiles: 10,
    });
    addRepository(workspace.id, 'demo', repoDir);

    const item = createWorkItem({
      type: 'task',
      title: 'Grok repo context',
      workspaceId: workspace.id,
      assignedAgentType: 'grok',
    });

    const { scope, auditFilePaths, basePath } = buildWorkItemContextScope(item);
    expect(scope.sensitivityLevel).toBeLessThan(3);

    const privacy = runPrivacyGuard(scope, 'grok', auditFilePaths, basePath, workspace.id);
    expect(privacy.passed).toBe(true);
    expect(privacy.blockedReasons).toHaveLength(0);

    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('should allow grok on AgentHub-like repo with test fixtures excluded', () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-repo-like-'));
    fs.mkdirSync(path.join(repoDir, 'src', 'backend', 'src', '__tests__'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'src', 'backend', 'src', 'index.ts'), 'export function main() {}');
    fs.writeFileSync(
      path.join(repoDir, 'src', 'backend', 'src', '__tests__', 'privacy-guard.test.ts'),
      'const key = "sk-abcdefghijklmnopqrstuvwxyz123456";'
    );
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# Project');

    const workspace = createWorkspace('AgentHub-like', undefined, {
      contextGlobs: ['*.ts', '*.md'],
      contextMaxFiles: 20,
    });
    addRepository(workspace.id, 'repo', repoDir);

    const item = createWorkItem({
      type: 'story',
      title: 'AgentHub Improvement',
      workspaceId: workspace.id,
      assignedAgentType: 'grok',
    });

    const { scope, auditFilePaths, basePath } = buildWorkItemContextScope(item);
    expect(scope.sensitivityLevel).toBeLessThan(3);
    expect(auditFilePaths.some((p) => p.includes('__tests__'))).toBe(false);

    const privacy = runPrivacyGuard(scope, 'grok', auditFilePaths, basePath, workspace.id);
    expect(privacy.passed).toBe(true);

    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('should block secrets in work directory context via privacy guard', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-secret-'));
    fs.writeFileSync(path.join(tmpDir, 'leak.ts'), 'const apiKey = "sk-abcdefghijklmnopqrstuvwxyz123456";');

    const item = createWorkItem({ type: 'task', title: 'Secret test', assignedAgentType: 'mock' });
    const { scope, auditFilePaths } = buildWorkItemContextScope(item, tmpDir);
    const privacy = runPrivacyGuard(scope, 'mock', auditFilePaths, tmpDir, item.workspaceId);

    expect(privacy.passed).toBe(false);
    expect(privacy.blockedReasons.length).toBeGreaterThan(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});