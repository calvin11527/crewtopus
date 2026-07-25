import { Router, Request, Response } from 'express';
import { isDatabaseHealthy } from '../database';
import { getConnectedClientCount } from '../websocket';
import { resolveApiToken } from '../middleware/api-auth';
import { getAgentCreditUsage } from '../modules/agent-credits';
import { listAgents } from '../modules/agent-registry';
import type { HealthResponse } from '../types';

const router = Router();
const startTime = Date.now();
const VERSION = '1.0.0';

router.get('/health', (_req: Request, res: Response) => {
  const dbHealthy = isDatabaseHealthy();
  const response: HealthResponse = {
    status: dbHealthy ? 'ok' : 'degraded',
    version: VERSION,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    database: dbHealthy,
  };
  res.status(dbHealthy ? 200 : 503).json(response);
});

/** Kubernetes-style readiness: DB required; reports auth + adapter readiness hints. */
router.get('/ready', (_req: Request, res: Response) => {
  const dbHealthy = isDatabaseHealthy();
  const agents = listAgents();
  const enabled = agents.filter((a) => a.enabled).length;
  const mockReady = agents.some((a) => a.type === 'mock' && a.enabled);
  const overBudget = getAgentCreditUsage().filter((u) => u.overBudget).map((u) => u.agentType);
  const body = {
    ready: dbHealthy,
    version: VERSION,
    database: dbHealthy,
    authRequired: Boolean(resolveApiToken()),
    agentsEnabled: enabled,
    mockReady,
    overBudgetAgentTypes: overBudget,
    checks: {
      database: dbHealthy ? 'pass' : 'fail',
      mockAdapter: mockReady ? 'pass' : 'warn',
    },
  };
  res.status(dbHealthy ? 200 : 503).json(body);
});

router.get('/status', (_req: Request, res: Response) => {
  res.json({
    version: VERSION,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    websocketClients: getConnectedClientCount(),
    database: isDatabaseHealthy(),
    authRequired: Boolean(resolveApiToken()),
  });
});

export default router;