import { Router, Request, Response } from 'express';
import {
  registerAgent,
  listAgents,
  getAgent,
  enableAgent,
  disableAgent,
  updateAgentStatus,
  updateAgentConfig,
  updateAgent,
} from '../modules/agent-registry';
import {
  hireNewAgent,
  hireExistingAgent,
  updateEmployment,
  terminateEmployment,
  listRoster,
  getRosterAgent,
  assertValidRole,
} from '../modules/agent-employment';
import { getCapabilitiesForAgent, syncCapabilitiesForAgentType } from '../modules/capability-registry';
import { calibrateAgentProviderUsage, getAgentCreditUsage } from '../modules/agent-credits';
import {
  listAgentModelCatalog,
  listModelsForAgentType,
  listRecommendedLocalModels,
  validateAgentModel,
} from '../modules/agent-models';
import { listSkillCatalog } from '../modules/agent-skills';
import type { AgentType, AgentStatus, AgentRole, EmploymentStatus, WorkingHoursBlock } from '../types';

const router = Router();

const VALID_TYPES: AgentType[] = ['claude', 'grok', 'copilot', 'antigravity', 'ollama', 'mock'];

router.get('/', (_req: Request, res: Response) => {
  res.json(listAgents());
});

router.get('/roster', (_req: Request, res: Response) => {
  res.json(listRoster());
});

router.get('/credits', (_req: Request, res: Response) => {
  res.json(getAgentCreditUsage());
});

router.get('/skills/catalog', (_req: Request, res: Response) => {
  res.json(listSkillCatalog());
});

router.get('/models', async (_req: Request, res: Response) => {
  try {
    res.json(await listAgentModelCatalog());
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

router.get('/local-models', async (_req: Request, res: Response) => {
  try {
    res.json(await listRecommendedLocalModels());
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

router.get('/models/:type', async (req: Request, res: Response) => {
  const type = req.params.type as AgentType;
  if (!VALID_TYPES.includes(type)) {
    res.status(400).json({ message: `type must be one of: ${VALID_TYPES.join(', ')}` });
    return;
  }
  try {
    res.json(await listModelsForAgentType(type));
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
});

router.post('/hire', (req: Request, res: Response) => {
  try {
    const { name, type, role, displayTitle, customRoleLabel, profileDescription, skills, timezone, workingHours, notes, config } =
      req.body as {
        name: string;
        type: AgentType;
        role: AgentRole;
        displayTitle?: string;
        customRoleLabel?: string;
        profileDescription?: string;
        skills?: string[];
        timezone?: string;
        workingHours?: WorkingHoursBlock[];
        notes?: string;
        config?: Record<string, unknown>;
      };
    if (!name || !type || !role) {
      res.status(400).json({ message: 'name, type, and role are required' });
      return;
    }
    if (!VALID_TYPES.includes(type)) {
      res.status(400).json({ message: `type must be one of: ${VALID_TYPES.join(', ')}` });
      return;
    }
    assertValidRole(role);
    const roster = hireNewAgent({
      name,
      type,
      role,
      displayTitle,
      customRoleLabel,
      profileDescription,
      skills,
      timezone,
      workingHours,
      notes,
      config,
    });
    res.status(201).json(roster);
  } catch (err) {
    res.status(422).json({ message: (err as Error).message });
  }
});

router.post('/', (req: Request, res: Response) => {
  const { name, type, config } = req.body;
  if (!name || !type) {
    res.status(400).json({ message: 'name and type are required' });
    return;
  }
  if (!VALID_TYPES.includes(type)) {
    res.status(400).json({ message: `type must be one of: ${VALID_TYPES.join(', ')}` });
    return;
  }
  try {
    const agent = registerAgent(name, type, config);
    res.status(201).json(agent);
  } catch (err) {
    res.status(409).json({ message: (err as Error).message });
  }
});

router.post('/:id/hire', (req: Request, res: Response) => {
  try {
    const { role, displayTitle, timezone, workingHours, notes } = req.body as {
      role: AgentRole;
      displayTitle?: string;
      timezone?: string;
      workingHours?: WorkingHoursBlock[];
      notes?: string;
    };
    if (!role) {
      res.status(400).json({ message: 'role is required' });
      return;
    }
    assertValidRole(role);
    const roster = hireExistingAgent(req.params.id, { role, displayTitle, timezone, workingHours, notes });
    res.status(201).json(roster);
  } catch (err) {
    const message = (err as Error).message;
    if (message === 'Agent not found') {
      res.status(404).json({ message });
      return;
    }
    res.status(422).json({ message });
  }
});

router.patch('/:id/employment', (req: Request, res: Response) => {
  try {
    const employment = updateEmployment(req.params.id, req.body);
    res.json(employment);
  } catch (err) {
    const message = (err as Error).message;
    if (message === 'Agent is not hired') {
      res.status(404).json({ message });
      return;
    }
    res.status(422).json({ message });
  }
});

router.post('/:id/terminate', (req: Request, res: Response) => {
  try {
    const employment = terminateEmployment(req.params.id);
    res.json(employment);
  } catch (err) {
    res.status(422).json({ message: (err as Error).message });
  }
});

router.get('/:id/roster', (req: Request, res: Response) => {
  const roster = getRosterAgent(req.params.id);
  if (!roster?.employment) {
    res.status(404).json({ message: 'Agent not hired' });
    return;
  }
  res.json(roster);
});

router.get('/:id', (req: Request, res: Response) => {
  const agent = getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ message: 'Agent not found' });
    return;
  }
  res.json(agent);
});

router.get('/:id/capabilities', (req: Request, res: Response) => {
  const agent = getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ message: 'Agent not found' });
    return;
  }
  res.json(getCapabilitiesForAgent(req.params.id));
});

router.post('/:id/enable', (req: Request, res: Response) => {
  const agent = enableAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ message: 'Agent not found' });
    return;
  }
  res.json(agent);
});

router.post('/:id/disable', (req: Request, res: Response) => {
  const agent = disableAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ message: 'Agent not found' });
    return;
  }
  res.json(agent);
});

router.patch('/:id/status', (req: Request, res: Response) => {
  const { status } = req.body as { status: AgentStatus };
  const valid: AgentStatus[] = ['idle', 'running', 'error', 'disabled'];
  if (!valid.includes(status)) {
    res.status(400).json({ message: `status must be one of: ${valid.join(', ')}` });
    return;
  }
  const agent = updateAgentStatus(req.params.id, status);
  if (!agent) {
    res.status(404).json({ message: 'Agent not found' });
    return;
  }
  res.json(agent);
});

/** Update adapter type, display name, and/or config (e.g. copilot → grok). */
router.patch('/:id', (req: Request, res: Response) => {
  const body = req.body as {
    type?: AgentType;
    name?: string;
    config?: Record<string, unknown>;
    model?: string;
  };

  const existing = getAgent(req.params.id);
  if (!existing) {
    res.status(404).json({ message: 'Agent not found' });
    return;
  }

  if (body.type !== undefined && !VALID_TYPES.includes(body.type)) {
    res.status(400).json({ message: `type must be one of: ${VALID_TYPES.join(', ')}` });
    return;
  }

  const configPatch: Record<string, unknown> = { ...(body.config ?? {}) };
  if (body.model !== undefined) {
    configPatch.model = body.model;
  }

  const nextType = body.type ?? existing.type;
  if ('model' in configPatch) {
    const modelError = validateAgentModel(nextType, configPatch.model);
    if (modelError) {
      res.status(400).json({ message: modelError });
      return;
    }
  }

  if ('creditLimit' in configPatch) {
    const limit = configPatch.creditLimit;
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0) {
      res.status(400).json({ message: 'creditLimit must be a non-negative number' });
      return;
    }
  }
  if ('monthlyTokenQuota' in configPatch) {
    const quota = configPatch.monthlyTokenQuota;
    if (quota !== null && (typeof quota !== 'number' || !Number.isFinite(quota) || quota <= 0)) {
      res.status(400).json({ message: 'monthlyTokenQuota must be a positive number or null to clear' });
      return;
    }
  }

  try {
    let agent = updateAgent(req.params.id, {
      type: body.type,
      name: body.name,
      config: Object.keys(configPatch).length > 0 ? configPatch : undefined,
    });
    if (!agent) {
      res.status(404).json({ message: 'Agent not found' });
      return;
    }

    if (body.type && body.type !== existing.type) {
      syncCapabilitiesForAgentType(agent.id, body.type);
    }

    // Optional dashboard % calibration after type/name patch.
    if (typeof configPatch.providerUsagePercent === 'number') {
      agent = calibrateAgentProviderUsage(req.params.id, configPatch.providerUsagePercent) ?? agent;
    }

    res.json(agent);
  } catch (err) {
    res.status(400).json({ message: (err as Error).message });
  }
});

router.patch('/:id/config', (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  if ('creditLimit' in body) {
    const limit = body.creditLimit;
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0) {
      res.status(400).json({ message: 'creditLimit must be a non-negative number' });
      return;
    }
  }
  if ('monthlyTokenQuota' in body) {
    const quota = body.monthlyTokenQuota;
    // null clears the quota (stop hard-blocking on token %); positive number sets a new cap.
    if (quota !== null && (typeof quota !== 'number' || !Number.isFinite(quota) || quota <= 0)) {
      res.status(400).json({ message: 'monthlyTokenQuota must be a positive number or null to clear' });
      return;
    }
  }
  if ('providerUsagePercent' in body) {
    const pct = body.providerUsagePercent;
    if (typeof pct !== 'number' || !Number.isFinite(pct) || pct <= 0 || pct > 100) {
      res.status(400).json({ message: 'providerUsagePercent must be between 0 and 100' });
      return;
    }
  }

  let agent = getAgent(req.params.id);
  if (!agent) {
    res.status(404).json({ message: 'Agent not found' });
    return;
  }

  if ('model' in body) {
    const modelError = validateAgentModel(agent.type, body.model);
    if (modelError) {
      res.status(400).json({ message: modelError });
      return;
    }
  }

  try {
    if (typeof body.providerUsagePercent === 'number') {
      agent = calibrateAgentProviderUsage(req.params.id, body.providerUsagePercent);
      if ('model' in body) {
        agent = updateAgentConfig(req.params.id, { model: body.model });
      }
    } else {
      agent = updateAgentConfig(req.params.id, body);
    }
  } catch (err) {
    res.status(400).json({ message: (err as Error).message });
    return;
  }

  if (!agent) {
    res.status(404).json({ message: 'Agent not found' });
    return;
  }
  res.json(agent);
});

export default router;