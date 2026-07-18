import { Router, Request, Response } from 'express';
import {
  createSession,
  getSession,
  listSessions,
  submitVote,
  resolveSession,
  escalateToHuman,
  setHumanDecision,
  runMultiAgentConsensus,
} from '../modules/consensus-engine';
import type { AgentType, ConsensusMode } from '../types';

const VALID_MODES: ConsensusMode[] = ['majority_vote', 'weighted_vote', 'human_review', 'single_authority'];

const router = Router();

router.get('/sessions', (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  res.json(listSessions(status as Parameters<typeof listSessions>[0]));
});

router.post('/sessions', (req: Request, res: Response) => {
  const { question, mode, config, workflowId } = req.body;
  if (!question || !mode) {
    res.status(400).json({ message: 'question and mode are required' });
    return;
  }
  if (!VALID_MODES.includes(mode)) {
    res.status(400).json({ message: `mode must be one of: ${VALID_MODES.join(', ')}` });
    return;
  }
  const session = createSession(question, mode, config, workflowId);
  res.status(201).json(session);
});

router.get('/sessions/:id', (req: Request, res: Response) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ message: 'Session not found' });
    return;
  }
  res.json(session);
});

router.post('/sessions/:id/votes', (req: Request, res: Response) => {
  const { agentType, opinion, weight, agentId } = req.body;
  if (!agentType || !opinion) {
    res.status(400).json({ message: 'agentType and opinion are required' });
    return;
  }
  const vote = submitVote(req.params.id, agentType, opinion, weight, agentId);
  if (!vote) {
    res.status(404).json({ message: 'Session not found or not open' });
    return;
  }
  res.status(201).json(vote);
});

router.post('/sessions/:id/resolve', (req: Request, res: Response) => {
  const session = resolveSession(req.params.id);
  if (!session) {
    res.status(404).json({ message: 'Session not found or not open' });
    return;
  }
  res.json(session);
});

router.post('/sessions/:id/escalate', (req: Request, res: Response) => {
  const session = escalateToHuman(req.params.id);
  if (!session) {
    res.status(404).json({ message: 'Session not found or not open' });
    return;
  }
  res.json(session);
});

router.post('/sessions/:id/decide', (req: Request, res: Response) => {
  const { decision } = req.body;
  if (!decision) {
    res.status(400).json({ message: 'decision is required' });
    return;
  }
  const session = setHumanDecision(req.params.id, decision);
  if (!session) {
    res.status(404).json({ message: 'Session not found' });
    return;
  }
  res.json(session);
});

router.post('/run', async (req: Request, res: Response) => {
  const { question, mode, agentTypes, workflowId } = req.body as {
    question: string;
    mode: ConsensusMode;
    agentTypes: AgentType[];
    workflowId?: string;
  };

  if (!question || !mode || !agentTypes?.length) {
    res.status(400).json({ message: 'question, mode, and agentTypes are required' });
    return;
  }

  try {
    const session = await runMultiAgentConsensus(question, mode, agentTypes, workflowId);
    res.status(201).json(session);
  } catch (err) {
    res.status(422).json({ message: (err as Error).message });
  }
});

export default router;