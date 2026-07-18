import { Router, Request, Response } from 'express';
import {
  listCapabilities,
  registerCapability,
  findAgentsByCapability,
  getCapabilityMap,
} from '../modules/capability-registry';
import { getAgent } from '../modules/agent-registry';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json(listCapabilities());
});

router.get('/map', (_req: Request, res: Response) => {
  res.json(getCapabilityMap());
});

router.get('/search/:name', (req: Request, res: Response) => {
  res.json(findAgentsByCapability(req.params.name));
});

router.post('/', (req: Request, res: Response) => {
  const { agentId, name, description } = req.body;
  if (!agentId || !name) {
    res.status(400).json({ message: 'agentId and name are required' });
    return;
  }
  if (!getAgent(agentId)) {
    res.status(404).json({ message: 'Agent not found' });
    return;
  }
  const capability = registerCapability(agentId, name, description);
  res.status(201).json(capability);
});

export default router;