import { Router, Request, Response } from 'express';
import { listAuditEntries, getAuditEntry, getAuditStats } from '../modules/audit-logger';
import { loadAuditSnapshot, hasAuditSnapshot } from '../modules/audit-snapshot';

const router = Router();

router.get('/stats', (_req: Request, res: Response) => {
  res.json(getAuditStats());
});

router.get('/', (req: Request, res: Response) => {
  const agentId = req.query.agentId as string | undefined;
  const workflowId = req.query.workflowId as string | undefined;
  const workItemId = req.query.workItemId as string | undefined;
  const loopIteration = req.query.loopIteration !== undefined ? Number(req.query.loopIteration) : undefined;
  const limit = Number(req.query.limit) || 100;
  const offset = Number(req.query.offset) || 0;

  res.json(listAuditEntries({ agentId, workflowId, workItemId, loopIteration, limit, offset }));
});

router.get('/:id/context', (req: Request, res: Response) => {
  const entry = getAuditEntry(req.params.id);
  if (!entry) {
    res.status(404).json({ message: 'Audit entry not found' });
    return;
  }
  if (!hasAuditSnapshot(req.params.id)) {
    res.status(404).json({ message: 'Context snapshot not available for this audit entry' });
    return;
  }
  const scope = loadAuditSnapshot(req.params.id);
  if (!scope) {
    res.status(404).json({ message: 'Context snapshot could not be read' });
    return;
  }
  res.json({ auditId: req.params.id, contextScope: scope });
});

router.get('/:id', (req: Request, res: Response) => {
  const entry = getAuditEntry(req.params.id);
  if (!entry) {
    res.status(404).json({ message: 'Audit entry not found' });
    return;
  }
  res.json(entry);
});

export default router;