import { Router, Request, Response } from 'express';
import { getDatabase } from '../database';
import { generateId, now, parseJson } from '../utils/helpers';
import {
  runPrivacyGuard,
  scanForSecrets,
  sanitizePaths,
  listPolicies,
  type PrivacyRule,
} from '../modules/privacy-guard';
import type { AgentType, ContextScope } from '../types';

const router = Router();

/** Simple in-memory rate limiter for privacy endpoints (local-first; per-IP). */
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(maxPerMinute = 60) {
  return (req: Request, res: Response, next: () => void): void => {
    const key = req.ip || req.socket.remoteAddress || 'local';
    const nowMs = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || bucket.resetAt <= nowMs) {
      bucket = { count: 0, resetAt: nowMs + 60_000 };
      rateBuckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > maxPerMinute) {
      res.status(429).json({ message: 'Rate limit exceeded. Try again shortly.' });
      return;
    }
    next();
  };
}


router.post('/scan', rateLimit(30), (req: Request, res: Response) => {
  const { content, location } = req.body;
  if (!content) {
    res.status(400).json({ message: 'content is required' });
    return;
  }
  res.json({ matches: scanForSecrets(content, location || 'input') });
});

router.post('/guard', rateLimit(30), (req: Request, res: Response) => {
  const { scope, agentType, filePaths, basePath, workspaceId } = req.body as {
    scope: ContextScope;
    agentType: AgentType;
    filePaths?: string[];
    basePath?: string;
    workspaceId?: string;
  };

  if (!scope || !agentType) {
    res.status(400).json({ message: 'scope and agentType are required' });
    return;
  }

  res.json(runPrivacyGuard(scope, agentType, filePaths, basePath, workspaceId));
});

router.post('/sanitize-paths', rateLimit(30), (req: Request, res: Response) => {
  const { filePaths, basePath } = req.body;
  if (!filePaths || !Array.isArray(filePaths)) {
    res.status(400).json({ message: 'filePaths array is required' });
    return;
  }
  res.json(sanitizePaths(filePaths, basePath));
});

router.get('/policies', (req: Request, res: Response) => {
  const workspaceId = req.query.workspaceId as string | undefined;
  res.json(listPolicies(workspaceId));
});

router.post('/policies', rateLimit(20), (req: Request, res: Response) => {
  const { name, rules, workspaceId } = req.body as {
    name: string;
    rules: PrivacyRule[];
    workspaceId?: string;
  };

  if (!name) {
    res.status(400).json({ message: 'name is required' });
    return;
  }

  const id = generateId();
  const timestamp = now();

  getDatabase()
    .prepare(
      'INSERT INTO privacy_policy (id, workspace_id, name, rules, created_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(id, workspaceId ?? null, name, JSON.stringify(rules || []), timestamp);

  res.status(201).json({ id, name, rules: rules || [], workspaceId, createdAt: timestamp });
});

export default router;