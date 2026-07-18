import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import http from 'http';
import { initDatabase, closeDatabase } from './database';
import { initWebSocket, closeWebSocket, getConnectedClientCount } from './websocket';
import { renderMetrics, setGauge } from './metrics';
import healthRouter from './routes/health';
import workspacesRouter from './routes/workspaces';
import fsRouter from './routes/fs';
import agentsRouter from './routes/agents';
import capabilitiesRouter from './routes/capabilities';
import supervisorRouter from './routes/supervisor';
import workflowsRouter from './routes/workflows';
import contextScopeRouter from './routes/context-scope';
import adaptersRouter from './routes/adapters';
import privacyRouter from './routes/privacy';
import approvalRouter from './routes/approval';
import auditRouter from './routes/audit';
import logsRouter from './routes/logs';
import proactiveRouter from './routes/proactive';
import consensusRouter from './routes/consensus';
import workItemsRouter from './routes/work-items';
import { seedDemoWorkItems } from './modules/work-items';
import { ensureGrokCopilotWorkflow } from './modules/work-item-pipeline';
import { seedDefaultAgents } from './modules/agent-registry';
import { seedDefaultCapabilities } from './modules/capability-registry';
import { seedDefaultPolicies } from './modules/seed-policies';
import { proactiveEngine } from './modules/proactive-engine';
import { getActiveExecutionCount } from './modules/workflow-engine';
import { shutdownAllAdapters } from './adapters';
import { reconcileSupervisorAgentLocks, recoverStaleSupervisorTasks } from './modules/supervisor';
import { recoverStaleLoopRuns } from './modules/loop-run';
import {
  recoverStaleLoopJobs,
  recoverOrphanedWorkItemLoops,
  recoverOrphanedInProgressWorkItems,
  updateQueueDepthGauge,
} from './modules/job-queue';
import { startLoopWorker, stopLoopWorker } from './modules/loop-worker';
import { startShiftScheduler, stopShiftScheduler } from './modules/shift-scheduler';
import { startResourceCleanup, stopResourceCleanup } from './modules/resource-cleanup';
import { closeRedisClient } from './modules/job-queue';

const PORT = Number(process.env.PORT) || 3000;
const startTime = Date.now();

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api', healthRouter);
app.use('/api/workspaces', workspacesRouter);
app.use('/api/fs', fsRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/capabilities', capabilitiesRouter);
app.use('/api/supervisor', supervisorRouter);
app.use('/api/workflows', workflowsRouter);
app.use('/api/context-scope', contextScopeRouter);
app.use('/api/adapters', adaptersRouter);
app.use('/api/privacy', privacyRouter);
app.use('/api/approval', approvalRouter);
app.use('/api/audit', auditRouter);
app.use('/api/logs', logsRouter);
app.use('/api/proactive', proactiveRouter);
app.use('/api/consensus', consensusRouter);
app.use('/api/work-items', workItemsRouter);

app.get('/metrics', (_req: Request, res: Response) => {
  setGauge('agenthub_uptime_seconds', 'Server uptime in seconds', Math.floor((Date.now() - startTime) / 1000));
  setGauge('agenthub_websocket_clients', 'Connected WebSocket clients', getConnectedClientCount());
  setGauge('agenthub_active_workflows', 'Currently running workflow executions', getActiveExecutionCount());
  updateQueueDepthGauge();
  res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(renderMetrics());
});

app.use((_req: Request, res: Response) => {
  res.status(404).json({ message: 'Not found' });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Error]', err.message);
  res.status(500).json({ message: err.message || 'Internal server error' });
});

initDatabase();
seedDefaultAgents();
seedDefaultCapabilities();
seedDefaultPolicies();
seedDemoWorkItems();
ensureGrokCopilotWorkflow();
recoverStaleSupervisorTasks();
reconcileSupervisorAgentLocks();
recoverStaleLoopRuns();
recoverStaleLoopJobs();
recoverOrphanedWorkItemLoops();
recoverOrphanedInProgressWorkItems();
proactiveEngine.initAllTriggers();
initWebSocket(server);
startLoopWorker();
startShiftScheduler();
startResourceCleanup();

server.listen(PORT, () => {
  console.log(`[AgentHub] Backend running on http://localhost:${PORT}`);
  console.log(`[AgentHub] WebSocket available at ws://localhost:${PORT}/ws`);
  console.log(`[AgentHub] Metrics available at http://localhost:${PORT}/metrics`);
});

async function shutdown(): Promise<void> {
  console.log('[AgentHub] Shutting down...');
  stopLoopWorker();
  stopShiftScheduler();
  stopResourceCleanup();
  proactiveEngine.shutdown();
  shutdownAllAdapters();
  closeWebSocket();
  await closeRedisClient();
  closeDatabase();
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);