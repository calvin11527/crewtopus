import { Router, Request, Response } from 'express';
import { proactiveEngine, registerWorkItemPipelineTrigger } from '../modules/proactive-engine';
import type { TriggerType } from '../types';

const VALID_TRIGGERS: TriggerType[] = [
  'file_changed',
  'git_commit',
  'pr_created',
  'build_failed',
  'dependency_updated',
  'schedule',
];

const router = Router();

router.get('/triggers', (req: Request, res: Response) => {
  const workspaceId = req.query.workspaceId as string | undefined;
  res.json(proactiveEngine.listTriggers(workspaceId));
});

router.post('/triggers', (req: Request, res: Response) => {
  const { triggerType, config, workspaceId, workflowId, workItemId } = req.body;
  if (!triggerType || !VALID_TRIGGERS.includes(triggerType)) {
    res.status(400).json({ message: `triggerType must be one of: ${VALID_TRIGGERS.join(', ')}` });
    return;
  }

  const mergedConfig = {
    ...(config ?? {}),
    ...(workItemId ? { workItemId, action: config?.action ?? 'enqueue_pipeline' } : {}),
  };

  const trigger = proactiveEngine.registerTrigger(triggerType, mergedConfig, workspaceId, workflowId);
  res.status(201).json(trigger);
});

router.get('/triggers/:id', (req: Request, res: Response) => {
  const trigger = proactiveEngine.getTrigger(req.params.id);
  if (!trigger) {
    res.status(404).json({ message: 'Trigger not found' });
    return;
  }
  res.json(trigger);
});

router.post('/triggers/:id/enable', (req: Request, res: Response) => {
  const trigger = proactiveEngine.enableTrigger(req.params.id);
  if (!trigger) {
    res.status(404).json({ message: 'Trigger not found' });
    return;
  }
  res.json(trigger);
});

router.post('/triggers/:id/disable', (req: Request, res: Response) => {
  const trigger = proactiveEngine.disableTrigger(req.params.id);
  if (!trigger) {
    res.status(404).json({ message: 'Trigger not found' });
    return;
  }
  res.json(trigger);
});

router.delete('/triggers/:id', (req: Request, res: Response) => {
  if (!proactiveEngine.deleteTrigger(req.params.id)) {
    res.status(404).json({ message: 'Trigger not found' });
    return;
  }
  res.status(204).send();
});

router.post('/triggers/work-item-pipeline', (req: Request, res: Response) => {
  const { workItemId, workspaceId, workflowId, debounceMs, maxIterations, autoLoop, demo } = req.body;
  if (!workItemId) {
    res.status(400).json({ message: 'workItemId is required' });
    return;
  }
  try {
    const trigger = registerWorkItemPipelineTrigger(workItemId, {
      workspaceId,
      workflowId,
      debounceMs,
      maxIterations,
      autoLoop,
      demo,
    });
    res.status(201).json(trigger);
  } catch (err) {
    const message = (err as Error).message;
    if (message === 'Work item not found') {
      res.status(404).json({ message });
      return;
    }
    res.status(422).json({ message });
  }
});

router.post('/fire', async (req: Request, res: Response) => {
  const { triggerType, payload, workflowId } = req.body;
  if (!triggerType || !VALID_TRIGGERS.includes(triggerType)) {
    res.status(400).json({ message: `triggerType must be one of: ${VALID_TRIGGERS.join(', ')}` });
    return;
  }
  const event = await proactiveEngine.fireTrigger(triggerType, payload, workflowId);
  res.status(201).json(event);
});

router.get('/events', (req: Request, res: Response) => {
  const limit = Number(req.query.limit) || 50;
  res.json(proactiveEngine.listEvents(limit));
});

export default router;