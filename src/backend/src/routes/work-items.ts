import { Router, Request, Response } from 'express';
import {
  createSprint,
  listSprints,
  getSprint,
  updateSprint,
  deleteSprint,
  createWorkItem,
  listWorkItems,
  getWorkItem,
  updateWorkItem,
  deleteWorkItem,
  getBoard,
  listWorkItemActivity,
  runWorkItemAgent,
  prepareWorkItemAgentRun,
} from '../modules/work-items';
import {
  runWorkItemPipeline,
  runWorkItemReviewRetry,
  ensureGrokCopilotWorkflow,
  createAgentHubImprovementTask,
  getWorkItemLoopHistory,
  enqueueWorkItemPipeline,
  enqueueLoopRetry,
  getLoopJob,
} from '../modules/work-item-pipeline';
import { buildLoopRetryPayload, isTerminalLoopStatus } from '../modules/loop-retry';
import { enqueueWorkItemAgent, getActiveJobForWorkItem } from '../modules/job-queue';
import { assertWorkItemRunnable, assertWorkItemEditable, WorkItemBusyError } from '../modules/work-item-guard';
import { runFullLifecycleSync, startFullLifecycle } from '../modules/full-lifecycle';
import {
  getSprintTeamView,
  setSprintTeam,
  setSprintAutomationMode,
  getSprintAutomationStatus,
  type SprintTeamMemberInput,
} from '../modules/sprint-team';
import { isAgentOnShift } from '../modules/agent-employment';
import type { AgentRole, SprintAutomationMode } from '../types';
import {
  createImprovementEpic,
  runEpicOrchestration,
  summarizeEpic,
} from '../modules/epic-orchestration';
import {
  getStoryQueueRun,
  resolveStoryQueueItems,
  runStoryQueue,
  startStoryQueueAsync,
} from '../modules/story-queue';
import { startSprintQueue, bootstrapEmptySprint } from '../modules/sprint-bootstrap';
import { listLoopRuns, getLoopRun } from '../modules/loop-run';
import { killCliProcessesForWorkItem } from '../modules/cli-process-registry';
import { getCliOutputForWorkItem } from '../modules/cli-stream';
import { listWorkItemDeliverables } from '../modules/work-item-context';
import type { WorkItemPriority, WorkItemStatus, WorkItemType, AgentType } from '../types';

const router = Router();

router.get('/board', (req: Request, res: Response) => {
  const sprintId = req.query.sprintId as string | undefined;
  res.json(getBoard(sprintId));
});

router.get('/sprints', (req: Request, res: Response) => {
  const workspaceId = req.query.workspaceId as string | undefined;
  res.json(listSprints(workspaceId));
});

router.post('/sprints', (req: Request, res: Response) => {
  const { name, goal, workspaceId, status, startDate, endDate } = req.body;
  const trimmedName = typeof name === 'string' ? name.trim() : '';
  if (!trimmedName) {
    res.status(400).json({ message: 'name is required' });
    return;
  }
  const sprint = createSprint(trimmedName, { goal, workspaceId, status, startDate, endDate });
  res.status(201).json(sprint);
});

router.get('/sprints/:id', (req: Request, res: Response) => {
  const sprint = getSprint(req.params.id);
  if (!sprint) {
    res.status(404).json({ message: 'Sprint not found' });
    return;
  }
  res.json(sprint);
});

router.patch('/sprints/:id', (req: Request, res: Response) => {
  const { name, goal, workspaceId, status, startDate, endDate } = req.body as {
    name?: string;
    goal?: string | null;
    workspaceId?: string | null;
    status?: 'planning' | 'active' | 'completed';
    startDate?: string | null;
    endDate?: string | null;
  };
  if (name !== undefined && !name.trim()) {
    res.status(400).json({ message: 'name cannot be empty' });
    return;
  }
  const sprint = updateSprint(req.params.id, { name, goal, workspaceId, status, startDate, endDate });
  if (!sprint) {
    res.status(404).json({ message: 'Sprint not found' });
    return;
  }
  res.json(sprint);
});

router.delete('/sprints/:id', (req: Request, res: Response) => {
  if (!deleteSprint(req.params.id)) {
    res.status(404).json({ message: 'Sprint not found' });
    return;
  }
  res.status(204).send();
});

router.get('/', (req: Request, res: Response) => {
  res.json(
    listWorkItems({
      sprintId: req.query.sprintId as string | undefined,
      workspaceId: req.query.workspaceId as string | undefined,
      parentId: req.query.parentId as string | undefined,
      status: req.query.status as WorkItemStatus | undefined,
      type: req.query.type as WorkItemType | undefined,
    })
  );
});

router.post('/', (req: Request, res: Response) => {
  const { type, title } = req.body as { type: WorkItemType; title: string };
  if (!type || !title) {
    res.status(400).json({ message: 'type and title are required' });
    return;
  }
  const item = createWorkItem(req.body);
  res.status(201).json(item);
});

router.post('/queue/run', async (req: Request, res: Response) => {
  try {
    const { sprintId, epicId, workItemIds, maxIterations, autoLoop, demo, skipDone, stopOnFailure, async: runAsync } =
      req.body as {
        sprintId?: string;
        epicId?: string;
        workItemIds?: string[];
        maxIterations?: number;
        autoLoop?: boolean;
        demo?: boolean;
        skipDone?: boolean;
        stopOnFailure?: boolean;
        async?: boolean;
      };

    const options = { maxIterations, autoLoop, demo, skipDone, stopOnFailure };

    // Empty sprint: bootstrap epic/story and start agents (same as /sprints/:id/run-queue)
    if (sprintId && !epicId && !workItemIds?.length) {
      const items = resolveStoryQueueItems({ sprintId });
      if (items.length === 0) {
        if (runAsync !== false) {
          const started = startSprintQueue(sprintId, options);
          if (started.mode === 'full_lifecycle' && started.lifecycle) {
            res.status(202).json({
              mode: 'full_lifecycle',
              bootstrapped: true,
              message: started.message,
              jobId: started.lifecycle.job.id,
              status: started.lifecycle.job.status,
              workItemId: started.lifecycle.workItemId,
              storyId: started.lifecycle.storyId,
              step: started.lifecycle.step,
              queueId: started.lifecycle.job.id,
              workItemIds: started.seedStory ? [started.seedStory.id] : [],
            });
            return;
          }
          res.status(202).json({ ...started.queue!, mode: 'story_queue', bootstrapped: started.bootstrapped, message: started.message });
          return;
        }
        const ensured = bootstrapEmptySprint(sprintId);
        res.json(await runStoryQueue(ensured.items, options));
        return;
      }
    }

    const items = resolveStoryQueueItems({ sprintId, epicId, workItemIds });
    if (items.length === 0) {
      res.status(400).json({ message: 'No runnable stories/tasks found for queue' });
      return;
    }

    if (runAsync !== false) {
      const pending = startStoryQueueAsync(items, options);
      res.status(202).json(pending);
      return;
    }

    const result = await runStoryQueue(items, options);
    res.json(result);
  } catch (err) {
    res.status(422).json({ message: (err as Error).message });
  }
});

router.get('/queue/:queueId', (req: Request, res: Response) => {
  const run = getStoryQueueRun(req.params.queueId);
  if (!run) {
    res.status(404).json({ message: 'Story queue run not found' });
    return;
  }
  res.json(run);
});

router.get('/sprints/:sprintId/team', (req: Request, res: Response) => {
  try {
    res.json(getSprintTeamView(req.params.sprintId));
  } catch (err) {
    res.status(422).json({ message: (err as Error).message });
  }
});

router.put('/sprints/:sprintId/team', (req: Request, res: Response) => {
  try {
    const { members, allowConflicts } = req.body as {
      members: SprintTeamMemberInput[];
      allowConflicts?: boolean;
    };
    if (!Array.isArray(members)) {
      res.status(400).json({ message: 'members array is required' });
      return;
    }
    res.json(setSprintTeam(req.params.sprintId, members, { allowConflicts }));
  } catch (err) {
    res.status(422).json({ message: (err as Error).message });
  }
});

router.put('/sprints/:sprintId/automation', (req: Request, res: Response) => {
  try {
    const { mode } = req.body as { mode: SprintAutomationMode };
    if (mode !== 'autonomous' && mode !== 'paused') {
      res.status(400).json({ message: 'mode must be autonomous or paused' });
      return;
    }
    res.json(setSprintAutomationMode(req.params.sprintId, mode));
  } catch (err) {
    res.status(422).json({ message: (err as Error).message });
  }
});

router.get('/sprints/:sprintId/automation/status', (req: Request, res: Response) => {
  try {
    res.json(getSprintAutomationStatus(req.params.sprintId));
  } catch (err) {
    res.status(422).json({ message: (err as Error).message });
  }
});

router.post('/sprints/:sprintId/run-queue', async (req: Request, res: Response) => {
  try {
    const { maxIterations, autoLoop, demo, skipDone, stopOnFailure, async: runAsync } = req.body as {
      maxIterations?: number;
      autoLoop?: boolean;
      demo?: boolean;
      skipDone?: boolean;
      stopOnFailure?: boolean;
      async?: boolean;
    };

    const options = { maxIterations, autoLoop, demo, skipDone, stopOnFailure };

    // Async path: bootstrap empty sprints (epic + seed story) and start BA→PM→pipeline or queue
    if (runAsync !== false) {
      const started = startSprintQueue(req.params.sprintId, options);

      if (started.mode === 'full_lifecycle' && started.lifecycle) {
        res.status(202).json({
          mode: 'full_lifecycle',
          bootstrapped: started.bootstrapped,
          message: started.message,
          jobId: started.lifecycle.job.id,
          status: started.lifecycle.job.status,
          workItemId: started.lifecycle.workItemId,
          storyId: started.lifecycle.storyId,
          step: started.lifecycle.step,
          phase: started.lifecycle.phase,
          workItemIds: started.seedStory ? [started.seedStory.id] : [],
          epicId: started.epic?.id,
          epicKey: started.epic?.key,
          seedStoryKey: started.seedStory?.key,
          // Compat shape for older clients that expect queue fields
          queueId: started.lifecycle.job.id,
          totals: { total: 1, completed: 0, approved: 0, escalated: 0, failed: 0, skipped: 0 },
        });
        return;
      }

      const queue = started.queue!;
      res.status(202).json({
        ...queue,
        mode: 'story_queue',
        bootstrapped: started.bootstrapped,
        message: started.message,
        epicId: started.epic?.id,
        epicKey: started.epic?.key,
        seedStoryKey: started.seedStory?.key,
      });
      return;
    }

    // Sync path: bootstrap if needed, then run queue serially
    const ensured = bootstrapEmptySprint(req.params.sprintId);
    if (ensured.items.length === 0) {
      res.status(400).json({ message: 'No runnable stories/tasks in this sprint' });
      return;
    }
    const result = await runStoryQueue(ensured.items, options);
    res.json({
      ...result,
      bootstrapped: ensured.bootstrapped,
      message: ensured.bootstrapped
        ? `Bootstrapped seed work and ran queue (${result.totals.total} item(s))`
        : `Ran queue (${result.totals.total} item(s))`,
    });
  } catch (err) {
    res.status(422).json({ message: (err as Error).message });
  }
});

router.post('/epics/improvement', (req: Request, res: Response) => {
  try {
    const { workspaceId, sprintId, sprintName } = req.body as {
      workspaceId?: string;
      sprintId?: string;
      sprintName?: string;
    };
    const bundle = createImprovementEpic({ workspaceId, sprintId, sprintName });
    res.status(201).json(bundle);
  } catch (err) {
    res.status(422).json({ message: (err as Error).message });
  }
});

router.get('/epics/:epicId/summary', (req: Request, res: Response) => {
  try {
    res.json(summarizeEpic(req.params.epicId));
  } catch (err) {
    const message = (err as Error).message;
    if (message === 'Epic not found') {
      res.status(404).json({ message });
      return;
    }
    res.status(422).json({ message });
  }
});

router.post('/epics/:epicId/run', async (req: Request, res: Response) => {
  try {
    const { maxIterations, autoLoop, stopOnFailure, skipDone, demo } = req.body as {
      maxIterations?: number;
      autoLoop?: boolean;
      stopOnFailure?: boolean;
      skipDone?: boolean;
      demo?: boolean;
    };
    const result = await runEpicOrchestration(req.params.epicId, {
      maxIterations,
      autoLoop,
      stopOnFailure,
      skipDone,
      demo,
    });
    res.json(result);
  } catch (err) {
    const message = (err as Error).message;
    if (message === 'Epic not found') {
      res.status(404).json({ message });
      return;
    }
    res.status(422).json({ message });
  }
});

router.post('/pipeline/demo', (req: Request, res: Response) => {
  const sprintId = req.body.sprintId as string | undefined;
  const item = createAgentHubImprovementTask(sprintId);
  const workflowId = ensureGrokCopilotWorkflow();
  res.status(201).json({ item, workflowId });
});

router.get('/pipeline/workflow', (_req: Request, res: Response) => {
  res.json({ workflowId: ensureGrokCopilotWorkflow() });
});

router.get('/jobs/:jobId', (req: Request, res: Response) => {
  const job = getLoopJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ message: 'Job not found' });
    return;
  }
  res.json(job);
});

router.get('/:id', (req: Request, res: Response) => {
  const item = getWorkItem(req.params.id);
  if (!item) {
    res.status(404).json({ message: 'Work item not found' });
    return;
  }
  res.json(item);
});

router.patch('/:id', (req: Request, res: Response) => {
  try {
    assertWorkItemEditable(req.params.id);
    const item = updateWorkItem(req.params.id, req.body);
    if (!item) {
      res.status(404).json({ message: 'Work item not found' });
      return;
    }
    res.json(item);
  } catch (err) {
    if (err instanceof WorkItemBusyError) {
      res.status(409).json({ message: err.reason, workItemId: err.workItemId });
      return;
    }
    const message = (err as Error).message;
    if (message === 'Work item not found') {
      res.status(404).json({ message });
      return;
    }
    res.status(422).json({ message });
  }
});

router.delete('/:id', (req: Request, res: Response) => {
  try {
    assertWorkItemEditable(req.params.id);
    const deleted = deleteWorkItem(req.params.id);
    if (!deleted) {
      res.status(404).json({ message: 'Work item not found' });
      return;
    }
    res.status(204).send();
  } catch (err) {
    if (err instanceof WorkItemBusyError) {
      res.status(409).json({ message: err.reason, workItemId: err.workItemId });
      return;
    }
    const message = (err as Error).message;
    if (message === 'Work item not found') {
      res.status(404).json({ message });
      return;
    }
    res.status(422).json({ message });
  }
});

router.get('/:id/activity', (req: Request, res: Response) => {
  const item = getWorkItem(req.params.id);
  if (!item) {
    res.status(404).json({ message: 'Work item not found' });
    return;
  }
  const limit = Number(req.query.limit) || 50;
  res.json(listWorkItemActivity(req.params.id, limit));
});

router.get('/:id/deliverables', (req: Request, res: Response) => {
  const item = getWorkItem(req.params.id);
  if (!item) {
    res.status(404).json({ message: 'Work item not found' });
    return;
  }
  res.json(listWorkItemDeliverables(item));
});

router.get('/:id/cli-output', (req: Request, res: Response) => {
  const item = getWorkItem(req.params.id);
  if (!item) {
    res.status(404).json({ message: 'Work item not found' });
    return;
  }
  const output = getCliOutputForWorkItem(req.params.id);
  if (!output) {
    res.status(404).json({ message: 'No CLI output captured for this work item' });
    return;
  }
  res.json(output);
});

router.post('/:id/loop/cancel', async (req: Request, res: Response) => {
  const item = getWorkItem(req.params.id);
  if (!item) {
    res.status(404).json({ message: 'Work item not found' });
    return;
  }

  const { requestLoopCancel } = await import('../modules/loop-cancel');
  requestLoopCancel(req.params.id);

  const killed = await killCliProcessesForWorkItem(req.params.id);
  if (item.loopStatus === 'running') {
    updateWorkItem(req.params.id, { loopStatus: 'cancelled', status: 'todo' });
  } else if (item.status === 'in_progress') {
    updateWorkItem(req.params.id, { status: 'todo' });
  }

  res.json({
    workItemId: req.params.id,
    killedProcesses: killed,
    loopStatus: item.loopStatus === 'running' ? 'cancelled' : item.loopStatus,
  });
});

router.get('/:id/loop', (req: Request, res: Response) => {
  try {
    res.json(getWorkItemLoopHistory(req.params.id));
  } catch (err) {
    const message = (err as Error).message;
    if (message === 'Work item not found') {
      res.status(404).json({ message });
      return;
    }
    res.status(500).json({ message });
  }
});

router.get('/:id/loop-runs', (req: Request, res: Response) => {
  const item = getWorkItem(req.params.id);
  if (!item) {
    res.status(404).json({ message: 'Work item not found' });
    return;
  }
  res.json(listLoopRuns(req.params.id));
});

router.get('/:id/loop-runs/:runId', (req: Request, res: Response) => {
  const run = getLoopRun(req.params.runId);
  if (!run || run.workItemId !== req.params.id) {
    res.status(404).json({ message: 'Loop run not found' });
    return;
  }
  res.json(run);
});

router.post('/:id/run-pipeline', async (req: Request, res: Response) => {
  try {
    const workflowId = ensureGrokCopilotWorkflow();
    const { maxIterations, autoLoop, demo, async: runAsync } = req.body as {
      maxIterations?: number;
      autoLoop?: boolean;
      demo?: boolean;
      async?: boolean;
    };

    if (runAsync !== false) {
      let item;
      try {
        item = assertWorkItemRunnable(req.params.id);
      } catch (err) {
        if (err instanceof WorkItemBusyError) {
          res.status(409).json({ message: err.reason, workItemId: err.workItemId, code: 'work_item_busy' });
          return;
        }
        throw err;
      }

      const existing = getActiveJobForWorkItem(req.params.id);
      if (existing) {
        res.status(202).json({
          jobId: existing.id,
          status: existing.status,
          workItemId: item.id,
          alreadyQueued: true,
        });
        return;
      }

      if (isTerminalLoopStatus(item.loopStatus)) {
        const { job } = enqueueLoopRetry(req.params.id, workflowId, { maxIterations, autoLoop, demo });
        prepareWorkItemAgentRun(req.params.id, job.id);
        res.status(202).json({ jobId: job.id, status: job.status, workItemId: item.id });
        return;
      }

      const job = enqueueWorkItemPipeline(req.params.id, workflowId, { maxIterations, autoLoop });
      prepareWorkItemAgentRun(req.params.id, job.id);
      updateWorkItem(req.params.id, { loopStatus: 'running' });
      res.status(202).json({ jobId: job.id, status: job.status, workItemId: item.id });
      return;
    }

    const item = getWorkItem(req.params.id);
    const pipelineOptions =
      item && isTerminalLoopStatus(item.loopStatus)
        ? buildLoopRetryPayload(req.params.id, item.loopStatus, { maxIterations, autoLoop, demo })
        : { maxIterations, autoLoop, demo };
    const result = await runWorkItemPipeline(req.params.id, pipelineOptions);
    res.json(result);
  } catch (err) {
    const message = (err as Error).message;
    if (err instanceof WorkItemBusyError) {
      res.status(409).json({ message: err.reason, workItemId: err.workItemId, code: 'work_item_busy' });
      return;
    }
    if (message === 'Work item not found') {
      res.status(404).json({ message });
      return;
    }
    res.status(422).json({ message });
  }
});

router.post('/:id/rerun-review', async (req: Request, res: Response) => {
  try {
    const workflowId = ensureGrokCopilotWorkflow();
    const { async: runAsync, autoChainFix } = req.body as { async?: boolean; autoChainFix?: boolean };

    if (runAsync !== false) {
      let item;
      try {
        item = assertWorkItemRunnable(req.params.id);
      } catch (err) {
        if (err instanceof WorkItemBusyError) {
          res.status(409).json({ message: err.reason, workItemId: err.workItemId, code: 'work_item_busy' });
          return;
        }
        throw err;
      }

      if (item.loopStatus !== 'escalated' && item.loopStatus !== 'failed') {
        res.status(422).json({
          message: `${item.key} is not awaiting review retry (loop status: ${item.loopStatus})`,
        });
        return;
      }

      const existing = getActiveJobForWorkItem(req.params.id);
      if (existing) {
        res.status(202).json({
          jobId: existing.id,
          status: existing.status,
          workItemId: item.id,
          alreadyQueued: true,
        });
        return;
      }

      const { job } = enqueueLoopRetry(req.params.id, workflowId, {
        retryMode: 'review_only',
        autoChainFix: autoChainFix !== false,
        orchestrator: 'manual_review_retry',
        summary: 'Harness re-review queued',
      });
      prepareWorkItemAgentRun(req.params.id, job.id);
      res.status(202).json({ jobId: job.id, status: job.status, workItemId: item.id });
      return;
    }

    const result = await runWorkItemReviewRetry(req.params.id, { autoChainFix: autoChainFix !== false });
    res.json(result);
  } catch (err) {
    const message = (err as Error).message;
    if (err instanceof WorkItemBusyError) {
      res.status(409).json({ message: err.reason, workItemId: err.workItemId, code: 'work_item_busy' });
      return;
    }
    if (message === 'Work item not found') {
      res.status(404).json({ message });
      return;
    }
    res.status(422).json({ message });
  }
});

router.post('/:id/run-agent', async (req: Request, res: Response) => {
  try {
    const { async: runAsync } = req.body as { async?: boolean };

    if (runAsync !== false) {
      let item;
      try {
        item = assertWorkItemRunnable(req.params.id);
      } catch (err) {
        if (err instanceof WorkItemBusyError) {
          res.status(409).json({ message: err.reason, workItemId: err.workItemId, code: 'work_item_busy' });
          return;
        }
        throw err;
      }

      const existing = getActiveJobForWorkItem(req.params.id);
      if (existing) {
        res.status(202).json({
          jobId: existing.id,
          status: existing.status,
          workItemId: item.id,
          alreadyQueued: true,
        });
        return;
      }

      const job = enqueueWorkItemAgent(req.params.id);
      prepareWorkItemAgentRun(req.params.id, job.id);
      res.status(202).json({ jobId: job.id, status: job.status, workItemId: item.id });
      return;
    }

    const result = await runWorkItemAgent(req.params.id);
    res.json(result);
  } catch (err) {
    const message = (err as Error).message;
    if (err instanceof WorkItemBusyError) {
      res.status(409).json({ message: err.reason, workItemId: err.workItemId, code: 'work_item_busy' });
      return;
    }
    if (message === 'Work item not found') {
      res.status(404).json({ message });
      return;
    }
    res.status(422).json({ message });
  }
});

/** BA → PM → developer pipeline from the current story phase (tasks skip to pipeline). */
router.post('/:id/run-lifecycle', async (req: Request, res: Response) => {
  try {
    const { async: runAsync, maxIterations, autoLoop } = req.body as {
      async?: boolean;
      maxIterations?: number;
      autoLoop?: boolean;
    };

    if (runAsync !== false) {
      try {
        assertWorkItemRunnable(req.params.id);
      } catch (err) {
        if (err instanceof WorkItemBusyError) {
          res.status(409).json({ message: err.reason, workItemId: err.workItemId, code: 'work_item_busy' });
          return;
        }
        throw err;
      }

      const started = startFullLifecycle(req.params.id, {
        maxIterations,
        autoLoop,
        orchestrator: 'manual_full_lifecycle',
      });

      res.status(202).json({
        jobId: started.job.id,
        status: started.job.status,
        workItemId: started.workItemId,
        storyId: started.storyId,
        step: started.step,
        phase: started.phase,
        message: started.message,
        alreadyQueued: started.alreadyQueued ?? false,
      });
      return;
    }

    const result = await runFullLifecycleSync(req.params.id, { maxIterations, autoLoop });
    res.json(result);
  } catch (err) {
    const message = (err as Error).message;
    if (err instanceof WorkItemBusyError) {
      res.status(409).json({ message: err.reason, workItemId: err.workItemId, code: 'work_item_busy' });
      return;
    }
    if (message === 'Work item not found') {
      res.status(404).json({ message });
      return;
    }
    res.status(422).json({ message });
  }
});

export default router;