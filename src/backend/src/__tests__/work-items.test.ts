import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createWorkItem,
  getBoard,
  getWorkItem,
  updateWorkItem,
  deleteWorkItem,
  createSprint,
  getSprint,
  updateSprint,
  deleteSprint,
  listSprints,
  runWorkItemAgent,
  seedDemoWorkItems,
  snapshotWorkDirFiles,
  diffWorkDirFiles,
} from '../modules/work-items';
import { listWorkItemActivity } from '../modules/work-item-activity';

describe('Work Items (Agile/Scrum)', () => {
  it('should CRUD sprints', () => {
    const created = createSprint('AH-66 Sprint', { goal: 'Ship toolbar', status: 'planning' });
    expect(created.name).toBe('AH-66 Sprint');
    expect(getSprint(created.id)?.goal).toBe('Ship toolbar');
    expect(created.status).toBe('planning');

    const renamed = updateSprint(created.id, { name: 'AH-66 Renamed', status: 'active' });
    expect(renamed?.name).toBe('AH-66 Renamed');
    expect(renamed?.status).toBe('active');
    expect(listSprints().some((s) => s.id === created.id)).toBe(true);

    // Empty rename is ignored (keeps existing name)
    const emptyRename = updateSprint(created.id, { name: '   ' });
    expect(emptyRename?.name).toBe('AH-66 Renamed');

    const item = createWorkItem({
      type: 'story',
      title: 'Linked to sprint',
      sprintId: created.id,
    });
    expect(item.sprintId).toBe(created.id);

    expect(deleteSprint(created.id)).toBe(true);
    expect(getSprint(created.id)).toBeNull();
    expect(deleteSprint(created.id)).toBe(false);
    // FK ON DELETE SET NULL — work item survives without sprint
    expect(getWorkItem(item.id)?.sprintId).toBeUndefined();
    // Item still listed on board (unassigned)
    const board = getBoard();
    const allItems = Object.values(board.columns).flat();
    expect(allItems.some((i) => i.id === item.id)).toBe(true);
  });

  it('should create work items with Jira-style keys', () => {
    const item = createWorkItem({ type: 'story', title: 'Test story', assignedAgentType: 'mock' });
    expect(item.key).toMatch(/^AH-\d+$/);
    expect(item.status).toBe('backlog');
  });

  it('should return board columns', () => {
    seedDemoWorkItems();
    const board = getBoard();
    expect(board.columns.backlog.length).toBeGreaterThan(0);
    expect(board.totals.items).toBeGreaterThan(0);
  });

  it('should log activity on status change', () => {
    const item = createWorkItem({ type: 'task', title: 'Move me', assignedAgentType: 'mock' });
    updateWorkItem(item.id, { status: 'todo' });
    const activity = listWorkItemActivity(item.id);
    expect(activity.some((a) => a.activityType === 'status_change')).toBe(true);
  });

  it('should delete a work item', () => {
    const item = createWorkItem({ type: 'task', title: 'Delete me' });
    expect(deleteWorkItem(item.id)).toBe(true);
    expect(getWorkItem(item.id)).toBeNull();
    expect(deleteWorkItem(item.id)).toBe(false);
  });

  it('should detect updated files as artifacts, not missing output', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wi-files-'));
    const filePath = path.join(tmp, 'improvements.md');
    fs.writeFileSync(filePath, '# v1\n');
    const before = snapshotWorkDirFiles(tmp);

    const later = Date.now() + 2000;
    fs.utimesSync(filePath, later / 1000, later / 1000);
    fs.writeFileSync(filePath, '# v2\nmore content');

    const diff = diffWorkDirFiles(before, snapshotWorkDirFiles(tmp));
    expect(diff.created).toEqual([]);
    expect(diff.updated).toEqual(['improvements.md']);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('should run mock agent on work item', async () => {
    const item = createWorkItem({
      type: 'story',
      title: 'Agent run test',
      assignedAgentType: 'mock',
      status: 'todo',
    });
    const result = await runWorkItemAgent(item.id);
    expect(result.item.status).toBe('in_review');
    expect(result.result.content.length).toBeGreaterThan(0);
    const activity = listWorkItemActivity(item.id);
    expect(activity.some((a) => a.activityType === 'agent_started')).toBe(true);
    expect(activity.some((a) => a.activityType === 'agent_completed')).toBe(true);
  });
});