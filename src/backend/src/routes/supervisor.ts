import { Router, Request, Response } from 'express';
import { supervisor } from '../modules/supervisor';
import type { AgentType } from '../types';

const router = Router();

router.get('/status', (_req: Request, res: Response) => {
  res.json(supervisor.getStatus());
});

router.get('/tasks', (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  res.json(supervisor.listTasks(status as Parameters<typeof supervisor.listTasks>[0]));
});

router.get('/tasks/:id', (req: Request, res: Response) => {
  const task = supervisor.getTask(req.params.id);
  if (!task) {
    res.status(404).json({ message: 'Task not found' });
    return;
  }
  res.json(task);
});

router.post('/tasks', (req: Request, res: Response) => {
  const { description, capability, workspaceId, preferredAgentType } = req.body;
  if (!description || !capability) {
    res.status(400).json({ message: 'description and capability are required' });
    return;
  }
  try {
    const task = supervisor.submitTask({
      description,
      capability,
      workspaceId,
      preferredAgentType: preferredAgentType as AgentType | undefined,
    });
    res.status(201).json(task);
  } catch (err) {
    res.status(422).json({ message: (err as Error).message });
  }
});

router.post('/tasks/:id/start', async (req: Request, res: Response) => {
  const task = await supervisor.startTask(req.params.id, {
    filePaths: req.body.filePaths,
    basePath: req.body.basePath,
    maxTokens: req.body.maxTokens,
    approvalId: req.body.approvalId,
  });
  if (!task) {
    res.status(404).json({ message: 'Task not found or not startable' });
    return;
  }
  res.json(task);
});

router.post('/tasks/:id/complete', (req: Request, res: Response) => {
  const { result } = req.body;
  if (!result) {
    res.status(400).json({ message: 'result is required' });
    return;
  }
  const task = supervisor.completeTask(req.params.id, result);
  if (!task) {
    res.status(404).json({ message: 'Task not found' });
    return;
  }
  res.json(task);
});

router.post('/tasks/:id/fail', (req: Request, res: Response) => {
  const { error } = req.body;
  const task = supervisor.failTask(req.params.id, error || 'Unknown error');
  if (!task) {
    res.status(404).json({ message: 'Task not found' });
    return;
  }
  res.json(task);
});

router.post('/tasks/:id/cancel', (req: Request, res: Response) => {
  const task = supervisor.cancelTask(req.params.id);
  if (!task) {
    res.status(404).json({ message: 'Task not found or already completed' });
    return;
  }
  res.json(task);
});

router.post('/select-agent', (req: Request, res: Response) => {
  const { capability, preferredAgentType } = req.body;
  if (!capability) {
    res.status(400).json({ message: 'capability is required' });
    return;
  }
  const selection = supervisor.selectAgent(capability, preferredAgentType as AgentType | undefined);
  if (!selection) {
    res.status(404).json({ message: `No agent found for capability "${capability}"` });
    return;
  }
  res.json(selection);
});

export default router;