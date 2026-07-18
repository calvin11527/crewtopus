import type { AgentType } from '../types';

export interface CliProcessEntry {
  workItemId: string;
  loopIteration?: number;
  pid: number;
  command: string;
  agentType: AgentType;
  startedAt: string;
}

const registry = new Map<number, CliProcessEntry>();

/** Register a spawned CLI process for lifecycle tracking. */
export function registerCliProcess(entry: CliProcessEntry): void {
  registry.set(entry.pid, entry);
}

/** Remove a process from the registry on completion. */
export function deregisterCliProcess(pid: number): void {
  registry.delete(pid);
}

/** List active CLI processes, optionally filtered by work item. */
export function listCliProcesses(workItemId?: string): CliProcessEntry[] {
  const entries = Array.from(registry.values());
  return workItemId ? entries.filter((e) => e.workItemId === workItemId) : entries;
}

/** Terminate CLI processes for a work item (SIGTERM, then SIGKILL after grace). */
export async function killCliProcessesForWorkItem(
  workItemId: string,
  graceMs = 3000
): Promise<number> {
  const entries = listCliProcesses(workItemId);
  let killed = 0;

  for (const entry of entries) {
    try {
      process.kill(entry.pid, 'SIGTERM');
      killed++;
    } catch {
      deregisterCliProcess(entry.pid);
    }
  }

  if (entries.length > 0) {
    await new Promise((r) => setTimeout(r, graceMs));
    for (const entry of entries) {
      try {
        process.kill(entry.pid, 0);
        process.kill(entry.pid, 'SIGKILL');
      } catch {
        /* already exited */
      }
      deregisterCliProcess(entry.pid);
    }
  }

  return killed;
}

/** Clear all registry entries (for tests). */
export function clearCliProcessRegistry(): void {
  registry.clear();
}