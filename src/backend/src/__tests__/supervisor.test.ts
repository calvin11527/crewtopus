import { getDatabase } from '../database';
import { generateId, now } from '../utils/helpers';
import {
  reconcileSupervisorAgentLocks,
  recoverStaleSupervisorTasks,
  supervisor,
} from '../modules/supervisor';

function insertSupervisorTask(
  status: string,
  assignedAgentId: string | null
): string {
  const id = generateId();
  const timestamp = now();
  getDatabase()
    .prepare(
      `INSERT INTO supervisor_task
       (id, description, capability, workspace_id, assigned_agent_id, assigned_agent_type, status, result, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      'test task',
      'implementation',
      null,
      assignedAgentId,
      assignedAgentId ? 'mock' : null,
      status,
      null,
      null,
      timestamp,
      timestamp
    );
  return id;
}

describe('Supervisor harness (AH-40)', () => {
  it('reconciles agent locks from persisted running tasks on restart', () => {
    const agentA = 'agent-running-a';
    const agentB = 'agent-assigned-b';
    const runningTaskId = insertSupervisorTask('running', agentA);
    const assignedTaskId = insertSupervisorTask('assigned', agentB);
    insertSupervisorTask('completed', 'agent-completed-c');

    supervisor.rebuildAgentLocksFrom(new Map());
    expect(supervisor.getLockedAgentCount()).toBe(0);

    const restored = reconcileSupervisorAgentLocks();
    expect(restored).toBe(2);
    expect(supervisor.isAgentLocked(agentA)).toBe(true);
    expect(supervisor.isAgentLocked(agentB)).toBe(true);
    expect(supervisor.isAgentLocked('agent-completed-c')).toBe(false);

    const status = supervisor.getStatus();
    expect(status.lockedAgents).toBe(2);
    expect(status.activeTasks).toBe(2);

    expect(runningTaskId).toBeTruthy();
    expect(assignedTaskId).toBeTruthy();
  });

  it('marks stale running tasks as failed on boot recovery', () => {
    const staleId = insertSupervisorTask('running', 'agent-stale');
    insertSupervisorTask('assigned', 'agent-assigned');

    const recovered = recoverStaleSupervisorTasks();
    expect(recovered).toBe(2);

    const stale = getDatabase()
      .prepare('SELECT status, error FROM supervisor_task WHERE id = ?')
      .get(staleId) as { status: string; error: string };
    expect(stale.status).toBe('failed');
    expect(stale.error).toContain('Interrupted by server restart');
  });
});