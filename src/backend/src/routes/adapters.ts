import { Router, Request, Response } from 'express';
import { getAdapterAvailability } from '../adapters';
import { buildContextScope } from '../modules/context-scope';
import { executeOutboundPipeline, PrivacyBlockedError } from '../modules/outbound-pipeline';
import { ApprovalRequiredError } from '../modules/approval-gate';
import type { AgentType } from '../types';

const router = Router();

router.get('/availability', async (_req: Request, res: Response) => {
  res.json(await getAdapterAvailability());
});

router.post('/:type/execute', async (req: Request, res: Response) => {
  const type = req.params.type as AgentType;
  const { prompt, filePaths, basePath, maxTokens, sensitivityLevel, config, approvalId, workspaceId } = req.body;

  if (!prompt) {
    res.status(400).json({ message: 'prompt is required' });
    return;
  }

  try {
    const contextScope = buildContextScope({
      filePaths: filePaths || [],
      basePath,
      maxTokens,
      sensitivityLevel,
    });

    const result = await executeOutboundPipeline({
      agentType: type,
      prompt,
      contextScope,
      capability: config?.capability,
      filePaths,
      basePath,
      workspaceId,
      approvalId,
    });

    res.json({
      content: result.content,
      tokenCount: result.tokenCount,
      metadata: { adapter: result.agentType, auditId: result.auditId },
    });
  } catch (err) {
    if (err instanceof ApprovalRequiredError) {
      res.status(403).json({
        message: err.message,
        approvalRequest: err.approvalRequest,
      });
      return;
    }
    if (err instanceof PrivacyBlockedError) {
      res.status(403).json({ message: err.message, reasons: err.reasons });
      return;
    }
    res.status(422).json({ message: (err as Error).message });
  }
});

export default router;