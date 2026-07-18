import { Router, Request, Response } from 'express';
import {
  getLogEvent,
  persistLogEvent,
  persistLogEvents,
  queryLogEvents,
} from '../modules/log-events';
import type { AgentType, LogEventInput, LogSeverity } from '../types';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  try {
    const agentId = (req.query.agentId ?? req.query.agent) as string | undefined;
    const agentType = req.query.agentType as AgentType | undefined;
    const severity = req.query.severity as LogSeverity | undefined;
    const text = (req.query.text ?? req.query.q) as string | undefined;
    const from = (req.query.from ?? req.query.startDate) as string | undefined;
    const to = (req.query.to ?? req.query.endDate) as string | undefined;
    const workItemId = req.query.workItemId as string | undefined;
    const limitRaw = req.query.limit;
    const offsetRaw = req.query.offset;
    if (limitRaw !== undefined && Number.isNaN(Number(limitRaw))) {
      res.status(400).json({ message: 'limit must be a number' });
      return;
    }
    if (offsetRaw !== undefined && Number.isNaN(Number(offsetRaw))) {
      res.status(400).json({ message: 'offset must be a number' });
      return;
    }
    const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;
    const offset = offsetRaw !== undefined ? Number(offsetRaw) : undefined;

    res.json(
      queryLogEvents({
        agentId,
        agentType,
        severity,
        text,
        from,
        to,
        workItemId,
        limit,
        offset,
      })
    );
  } catch (err) {
    res.status(400).json({ message: (err as Error).message });
  }
});

router.post('/', (req: Request, res: Response) => {
  try {
    const body = req.body as LogEventInput | { events?: LogEventInput[] };

    if (body && typeof body === 'object' && 'events' in body) {
      if (!Array.isArray(body.events)) {
        res.status(400).json({ message: 'events must be an array' });
        return;
      }
      const events = persistLogEvents(body.events);
      res.status(201).json({ items: events, total: events.length });
      return;
    }

    const event = persistLogEvent(body as LogEventInput);
    res.status(201).json(event);
  } catch (err) {
    res.status(400).json({ message: (err as Error).message });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  const event = getLogEvent(req.params.id);
  if (!event) {
    res.status(404).json({ message: 'Log event not found' });
    return;
  }
  res.json(event);
});

export default router;