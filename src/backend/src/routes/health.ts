import { Router, Request, Response } from 'express';
import { isDatabaseHealthy } from '../database';
import { getConnectedClientCount } from '../websocket';
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

router.get('/status', (_req: Request, res: Response) => {
  res.json({
    version: VERSION,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    websocketClients: getConnectedClientCount(),
    database: isDatabaseHealthy(),
  });
});

export default router;