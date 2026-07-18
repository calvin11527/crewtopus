import { Router, Request, Response } from 'express';
import {
  buildContextScope,
  truncateToTokenBudget,
  countScopeTokens,
  hashContext,
  classifySensitivity,
} from '../modules/context-scope';
import type { ContextScope } from '../types';

const router = Router();

router.post('/build', (req: Request, res: Response) => {
  const { filePaths, basePath, includeDiffs, includeSymbols, maxTokens, sensitivityLevel } = req.body;

  if (!filePaths || !Array.isArray(filePaths)) {
    res.status(400).json({ message: 'filePaths array is required' });
    return;
  }

  const scope = buildContextScope({
    filePaths,
    basePath,
    includeDiffs,
    includeSymbols,
    maxTokens,
    sensitivityLevel,
  });

  res.json({
    scope,
    tokenCount: countScopeTokens(scope),
    contextHash: hashContext(scope),
    sensitivityLevel: scope.sensitivityLevel,
  });
});

router.post('/truncate', (req: Request, res: Response) => {
  const scope = req.body as ContextScope;
  if (!scope || !scope.maxTokens) {
    res.status(400).json({ message: 'scope with maxTokens is required' });
    return;
  }

  const truncated = truncateToTokenBudget(scope);
  res.json({
    scope: truncated,
    tokenCount: countScopeTokens(truncated),
    contextHash: hashContext(truncated),
  });
});

router.post('/classify', (req: Request, res: Response) => {
  const { filePaths, basePath } = req.body;
  if (!filePaths || !Array.isArray(filePaths)) {
    res.status(400).json({ message: 'filePaths array is required' });
    return;
  }

  const level = classifySensitivity(filePaths, basePath);
  res.json({ sensitivityLevel: level });
});

router.post('/hash', (req: Request, res: Response) => {
  const scope = req.body as ContextScope;
  if (!scope) {
    res.status(400).json({ message: 'scope is required' });
    return;
  }
  res.json({ contextHash: hashContext(scope), tokenCount: countScopeTokens(scope) });
});

export default router;