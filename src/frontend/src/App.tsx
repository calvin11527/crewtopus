import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Workspaces from './pages/Workspaces';
import Agents from './pages/Agents';
import Workflows from './pages/Workflows';
import Board from './pages/Board';
import Privacy from './pages/Privacy';
import Audit from './pages/Audit';
import Logs from './pages/Logs';
import { wsClient } from './api/client';
import { useAppStore } from './stores/useAppStore';
import { useCliPreviewStore } from './stores/useCliPreviewStore';
import { queryKeys } from './api/hooks';

export default function App() {
  const addLiveEvent = useAppStore((s) => s.addLiveEvent);
  const setConnectionStatus = useAppStore((s) => s.setConnectionStatus);
  const setPendingJob = useAppStore((s) => s.setPendingJob);
  const clearPendingJob = useAppStore((s) => s.clearPendingJob);
  const ingestCliPreview = useCliPreviewStore((s) => s.ingestMessage);
  const qc = useQueryClient();

  useEffect(() => {
    wsClient.connect();

    const unsubStatus = wsClient.onStatusChange((status) => {
      setConnectionStatus(status);
    });

    const unsub = wsClient.subscribe((msg) => {
      addLiveEvent(msg);
      ingestCliPreview(msg);

      if (msg.type === 'agent:status') {
        qc.invalidateQueries({ queryKey: queryKeys.agents });
      }
      if (msg.type === 'workflow:update' || msg.type === 'workflow:step') {
        qc.invalidateQueries({ queryKey: queryKeys.workflows });
      }
      if (msg.type === 'audit:entry') {
        qc.invalidateQueries({ queryKey: queryKeys.audit });
        qc.invalidateQueries({ queryKey: queryKeys.auditStats });
        qc.invalidateQueries({ queryKey: queryKeys.agentCredits });
      }
      if (msg.type === 'approval:request') {
        qc.invalidateQueries({ queryKey: queryKeys.approvals });
      }
      if (msg.type === 'loop:job') {
        const workItemId =
          typeof msg.payload.workItemId === 'string' ? msg.payload.workItemId : null;
        const jobId = typeof msg.payload.jobId === 'string' ? msg.payload.jobId : null;
        const status = typeof msg.payload.status === 'string' ? msg.payload.status : '';
        if (workItemId && jobId && (status === 'pending' || status === 'running')) {
          setPendingJob(workItemId, jobId);
        } else if (
          workItemId &&
          (status === 'completed' || status === 'failed' || status === 'cancelled')
        ) {
          clearPendingJob(workItemId);
        }
      }

      if (
        msg.type === 'work_item:update' ||
        msg.type === 'work_item:activity' ||
        msg.type === 'work_item:pipeline_step' ||
        msg.type === 'work_item:loop_update' ||
        msg.type === 'loop:job' ||
        msg.type === 'shift:update' ||
        msg.type === 'sprint_automation:status' ||
        msg.type === 'story_queue:progress'
      ) {
        qc.invalidateQueries({ queryKey: ['work-items'] });
        const sprintId =
          msg.payload && typeof msg.payload === 'object' && 'sprintId' in msg.payload
            ? String((msg.payload as { sprintId: string }).sprintId)
            : null;
        if (sprintId) {
          qc.invalidateQueries({ queryKey: ['work-items', 'sprints', sprintId, 'automation'] });
          qc.invalidateQueries({ queryKey: ['work-items', 'sprints', sprintId, 'team'] });
        }
        if (msg.type === 'shift:update' || msg.type === 'sprint_automation:status') {
          qc.invalidateQueries({ queryKey: ['agents', 'roster'] });
        }
        const workItemId =
          msg.payload && typeof msg.payload === 'object' && 'workItemId' in msg.payload
            ? String((msg.payload as { workItemId: string }).workItemId)
            : null;
        if (workItemId) {
          qc.invalidateQueries({ queryKey: queryKeys.workItemActivity(workItemId) });
          qc.invalidateQueries({ queryKey: queryKeys.workItemLoop(workItemId) });
          qc.invalidateQueries({ queryKey: queryKeys.workItemDeliverables(workItemId) });
        }
      }
    });

    return () => {
      unsubStatus();
      unsub();
      wsClient.disconnect();
    };
  }, [addLiveEvent, setConnectionStatus, setPendingJob, clearPendingJob, ingestCliPreview, qc]);

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="workspaces" element={<Workspaces />} />
        <Route path="agents" element={<Agents />} />
        <Route path="board" element={<Board />} />
        <Route path="workflows" element={<Workflows />} />
        <Route path="privacy" element={<Privacy />} />
        <Route path="audit" element={<Audit />} />
        <Route path="logs" element={<Logs />} />
      </Route>
    </Routes>
  );
}