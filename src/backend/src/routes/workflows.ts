import { Router, Request, Response } from 'express';
import {
  createWorkflow,
  listWorkflows,
  getWorkflow,
  updateWorkflow,
  deleteWorkflow,
  executeWorkflow,
  pauseExecution,
  resumeExecution,
  cancelExecution,
  getExecution,
  listExecutions,
} from '../modules/workflow-engine';
import type { WorkflowDefinition } from '../types';

const router = Router();

router.get('/executions/:executionId', (req: Request, res: Response) => {
  const execution = getExecution(req.params.executionId);
  if (!execution) {
    res.status(404).json({ message: 'Execution not found' });
    return;
  }
  res.json(execution);
});

router.post('/executions/:executionId/pause', (req: Request, res: Response) => {
  const execution = pauseExecution(req.params.executionId);
  if (!execution) {
    res.status(404).json({ message: 'Execution not found or not pausable' });
    return;
  }
  res.json(execution);
});

router.post('/executions/:executionId/resume', async (req: Request, res: Response) => {
  const execution = await resumeExecution(req.params.executionId);
  if (!execution) {
    res.status(404).json({ message: 'Execution not found or not resumable' });
    return;
  }
  res.json(execution);
});

router.post('/executions/:executionId/cancel', (req: Request, res: Response) => {
  const execution = cancelExecution(req.params.executionId);
  if (!execution) {
    res.status(404).json({ message: 'Execution not found' });
    return;
  }
  res.json(execution);
});

router.get('/', (req: Request, res: Response) => {
  const workspaceId = req.query.workspaceId as string | undefined;
  res.json(listWorkflows(workspaceId));
});

router.post('/', (req: Request, res: Response) => {
  const { name, definition, workspaceId } = req.body as {
    name: string;
    definition: WorkflowDefinition;
    workspaceId?: string;
  };
  const hasSteps = Array.isArray(definition?.steps) && definition.steps.length > 0;
  const hasLoops = Array.isArray(definition?.loops) && definition.loops.length > 0;
  if (!name || (!hasSteps && !hasLoops)) {
    res.status(400).json({ message: 'name and definition.steps or definition.loops are required' });
    return;
  }
  const workflow = createWorkflow(name, definition, workspaceId);
  res.status(201).json(workflow);
});

router.get('/:id', (req: Request, res: Response) => {
  const workflow = getWorkflow(req.params.id);
  if (!workflow) {
    res.status(404).json({ message: 'Workflow not found' });
    return;
  }
  res.json(workflow);
});

router.put('/:id', (req: Request, res: Response) => {
  const workflow = updateWorkflow(req.params.id, req.body);
  if (!workflow) {
    res.status(404).json({ message: 'Workflow not found' });
    return;
  }
  res.json(workflow);
});

router.delete('/:id', (req: Request, res: Response) => {
  if (!deleteWorkflow(req.params.id)) {
    res.status(404).json({ message: 'Workflow not found' });
    return;
  }
  res.status(204).send();
});

router.get('/:id/executions', (req: Request, res: Response) => {
  res.json(listExecutions(req.params.id));
});

router.post('/:id/execute', async (req: Request, res: Response) => {
  try {
    const execution = await executeWorkflow(req.params.id, {
      filePaths: req.body.filePaths,
      basePath: req.body.basePath,
      maxTokens: req.body.maxTokens,
      workItemId: req.body.workItemId,
      maxLoopIterations: req.body.maxLoopIterations,
      autoLoop: req.body.autoLoop,
    });
    res.status(201).json(execution);
  } catch (err) {
    res.status(422).json({ message: (err as Error).message });
  }
});

export default router;