import fs from 'fs';
import path from 'path';
import type { AdapterInput } from './base';

/** Directories Copilot/Claude should access when writing work-item artifacts. */
export function collectWorkItemAllowedDirs(cwd: string): string[] {
  const resolved = path.resolve(cwd);
  const dirs = new Set<string>([resolved]);
  let current = resolved;

  for (let depth = 0; depth < 6; depth++) {
    const parent = path.dirname(current);
    if (parent === current) break;
    dirs.add(parent);
    if (path.basename(parent) === '.agenthub-work') {
      dirs.add(path.dirname(parent));
      break;
    }
    current = parent;
  }

  return [...dirs];
}

/** True when the agent must write files (implement, BA requirements, PM plan artifacts). */
export function needsFileWriteAccess(input: AdapterInput): boolean {
  const capability = input.config?.capability as string | undefined;
  const permissionMode = String(input.config?.permissionMode ?? '');
  const pipelinePhase = String(input.config?.pipelinePhase ?? '');

  return (
    capability === 'implementation' ||
    // BA / PM lifecycle phases write requirements.md, plan.md, etc.
    capability === 'analysis' ||
    capability === 'planning' ||
    pipelinePhase === 'implementation' ||
    pipelinePhase === 'planning' ||
    permissionMode === 'bypassPermissions' ||
    permissionMode === 'acceptEdits'
  );
}

/** Copilot CLI: set working dir and allow tool access to work-item output paths. */
export function appendCopilotPermissionArgs(args: string[], input: AdapterInput): string[] {
  const cwd = input.config?.cwd as string | undefined;
  const writable = needsFileWriteAccess(input);

  if (cwd) {
    fs.mkdirSync(cwd, { recursive: true });
    args.push('-C', cwd);
    for (const dir of collectWorkItemAllowedDirs(cwd)) {
      args.push('--add-dir', dir);
    }
  }

  if (writable || process.env.COPILOT_ALLOW_ALL === 'true') {
    args.push('--allow-all-tools');
    if (process.env.COPILOT_ALLOW_ALL_PATHS !== 'false') {
      args.push('--allow-all-paths');
    }
  } else if (process.env.COPILOT_YOLO === 'true') {
    args.push('--yolo');
  }

  return args;
}

/** Claude Code CLI: allow tool access to work-item paths and set permission mode. */
export function appendClaudePermissionArgs(args: string[], input: AdapterInput): string[] {
  const cwd = input.config?.cwd as string | undefined;
  const capability = input.config?.capability as string | undefined;
  const permissionMode = String(input.config?.permissionMode ?? '');
  const writable = needsFileWriteAccess(input);

  if (cwd) {
    fs.mkdirSync(cwd, { recursive: true });
    for (const dir of collectWorkItemAllowedDirs(cwd)) {
      args.push('--add-dir', dir);
    }
  }

  if (writable || permissionMode === 'bypassPermissions') {
    args.push('--permission-mode', 'bypassPermissions');
  } else if (permissionMode === 'plan' || permissionMode === 'readOnly') {
    args.push('--permission-mode', 'plan');
  } else if (permissionMode === 'acceptEdits') {
    args.push('--permission-mode', 'acceptEdits');
  } else if (capability === 'review') {
    args.push('--permission-mode', 'plan');
  }

  return args;
}