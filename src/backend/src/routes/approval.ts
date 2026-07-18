import { Router, Request, Response } from 'express';
import {
  listApprovalRequests,
  getApprovalRequest,
  approveRequest,
  rejectRequest,
  modifyAndApprove,
  requiresApproval,
} from '../modules/approval-gate';
import type { ContextScope } from '../types';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  res.json(listApprovalRequests(status as Parameters<typeof listApprovalRequests>[0]));
});

router.get('/check', (req: Request, res: Response) => {
  const level = Number(req.query.sensitivityLevel ?? 0);
  res.json({ requiresApproval: requiresApproval(level as 0 | 1 | 2 | 3) });
});

router.get('/:id', (req: Request, res: Response) => {
  const request = getApprovalRequest(req.params.id);
  if (!request) {
    res.status(404).json({ message: 'Approval request not found' });
    return;
  }
  res.json(request);
});

router.post('/:id/approve', (req: Request, res: Response) => {
  const request = approveRequest(req.params.id);
  if (!request) {
    res.status(404).json({ message: 'Approval request not found or not pending' });
    return;
  }
  res.json(request);
});

router.post('/:id/reject', (req: Request, res: Response) => {
  const request = rejectRequest(req.params.id);
  if (!request) {
    res.status(404).json({ message: 'Approval request not found or not pending' });
    return;
  }
  res.json(request);
});

router.post('/:id/modify', (req: Request, res: Response) => {
  const modifiedScope = req.body as ContextScope;
  if (!modifiedScope) {
    res.status(400).json({ message: 'modified context scope is required' });
    return;
  }
  const request = modifyAndApprove(req.params.id, modifiedScope);
  if (!request) {
    res.status(404).json({ message: 'Approval request not found or not pending' });
    return;
  }
  res.json(request);
});

export default router;