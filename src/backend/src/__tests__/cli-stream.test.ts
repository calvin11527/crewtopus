import fs from 'fs';
import os from 'os';
import path from 'path';
import { createCliStreamHandlers, endCliStream, getCliOutputForWorkItem, clearCliStreamBuffers } from '../modules/cli-stream';
import * as websocket from '../websocket';

describe('cli-stream', () => {
  let prevWorkDir: string | undefined;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenthub-cli-stream-'));
    prevWorkDir = process.env.AGENTHUB_WORK_DIR;
    process.env.AGENTHUB_WORK_DIR = tmpDir;
    clearCliStreamBuffers();
    jest.useFakeTimers();
    jest.spyOn(websocket, 'broadcast').mockImplementation(() => {});
  });

  afterEach(() => {
    clearCliStreamBuffers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    process.env.AGENTHUB_WORK_DIR = prevWorkDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('buffers and flushes stdout chunks for a work item', () => {
    const handlers = createCliStreamHandlers({
      workItemId: 'wi-1',
      agentType: 'mock',
      phase: 'implement',
      loopIteration: 1,
    });

    handlers.onStdout?.('line one\n');
    handlers.onStdout?.('line two');

    expect(websocket.broadcast).not.toHaveBeenCalled();

    jest.advanceTimersByTime(50);

    expect(websocket.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'work_item:cli_output',
        payload: expect.objectContaining({
          workItemId: 'wi-1',
          stream: 'stdout',
          chunk: 'line one\nline two',
          agentType: 'mock',
          phase: 'implement',
          loopIteration: 1,
        }),
      })
    );
  });

  it('flushes remaining buffer on endCliStream', () => {
    const handlers = createCliStreamHandlers({
      workItemId: 'wi-2',
      agentType: 'grok',
    });

    handlers.onStderr?.('warning: slow');

    endCliStream('wi-2', { agentType: 'grok' });

    expect(websocket.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'work_item:cli_output',
        payload: expect.objectContaining({
          workItemId: 'wi-2',
          stream: 'stderr',
          chunk: 'warning: slow',
        }),
      })
    );
  });

  it('retains output in ring buffer for post-mortem retrieval', () => {
    const handlers = createCliStreamHandlers({ workItemId: 'wi-3', agentType: 'grok' });
    handlers.onStdout?.('persisted output');
    const snapshot = getCliOutputForWorkItem('wi-3');
    expect(snapshot?.stdout).toBe('persisted output');
  });

  it('spills CLI output to disk and recovers after ring buffer cleared', () => {
    const handlers = createCliStreamHandlers({ workItemId: 'wi-persist', agentType: 'grok' });
    handlers.onStdout?.('disk-spilled output');
    handlers.onStderr?.('disk-spilled warning');

    const logPath = path.join(tmpDir, '.agenthub-work', '_streams', 'wi-persist.log');
    expect(fs.existsSync(logPath)).toBe(true);
    expect(fs.readFileSync(logPath, 'utf-8')).toContain('[stdout] disk-spilled output');
    expect(fs.readFileSync(logPath, 'utf-8')).toContain('[stderr] disk-spilled warning');

    clearCliStreamBuffers();
    const snapshot = getCliOutputForWorkItem('wi-persist');
    expect(snapshot?.stdout).toContain('disk-spilled output');
    expect(snapshot?.logPath).toBe(logPath);
  });
});