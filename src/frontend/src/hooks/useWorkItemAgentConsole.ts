import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { wsClient } from '../api/client';
import type { WorkItem, WorkItemActivity } from '../types';
import {
  appendConsoleEntries,
  appendConsoleEntry,
  consoleWelcomeEntry,
  deriveConsoleStatus,
  formatWorkItemConsoleEntry,
  INITIAL_CLI_STREAM_STATE,
  integrateCliOutput,
  matchesWorkItemConsole,
  seedConsoleEntriesFromActivity,
  updateStatusFromMessage,
  type AgentConsoleStatus,
  type CliStreamState,
  type ConsoleLogEntry,
} from '../utils/work-item-console';

interface UseWorkItemAgentConsoleInput {
  workItem: WorkItem | null;
  activity: WorkItemActivity[] | undefined;
}

function buildInitialEntries(
  workItem: WorkItem,
  activity: WorkItemActivity[] | undefined
): ConsoleLogEntry[] {
  const welcome = consoleWelcomeEntry(workItem.key, workItem.loopStatus);
  const seeded = seedConsoleEntriesFromActivity(activity ?? []);
  return seeded.length > 0 ? [welcome, ...seeded] : [welcome];
}

export function useWorkItemAgentConsole({ workItem, activity }: UseWorkItemAgentConsoleInput) {
  const workItemId = workItem?.id ?? null;
  const [entries, setEntries] = useState<ConsoleLogEntry[]>([]);
  const [status, setStatus] = useState<AgentConsoleStatus>({ isLive: false });
  const [sessionKey, setSessionKey] = useState(0);
  const activeItemIdRef = useRef<string | null>(null);
  const historySeededRef = useRef(false);
  const lastActivityCountRef = useRef(0);
  const cliStreamStateRef = useRef<CliStreamState>(INITIAL_CLI_STREAM_STATE);

  useEffect(() => {
    if (!workItem) {
      activeItemIdRef.current = null;
      historySeededRef.current = false;
      cliStreamStateRef.current = INITIAL_CLI_STREAM_STATE;
      setEntries([]);
      setStatus({ isLive: false });
      return;
    }

    const itemChanged = activeItemIdRef.current !== workItem.id;
    if (itemChanged) {
      activeItemIdRef.current = workItem.id;
      historySeededRef.current = (activity?.length ?? 0) > 0;
      lastActivityCountRef.current = activity?.length ?? 0;
      cliStreamStateRef.current = INITIAL_CLI_STREAM_STATE;
      setEntries(buildInitialEntries(workItem, activity));
      setStatus(
        deriveConsoleStatus(workItem.id, workItem.loopStatus, workItem.status, [], null)
      );
      setSessionKey((k) => k + 1);
      return;
    }

    const activityCount = activity?.length ?? 0;
    if (!historySeededRef.current && activityCount > 0) {
      historySeededRef.current = true;
      lastActivityCountRef.current = activityCount;
      setEntries(buildInitialEntries(workItem, activity));
      return;
    }

    if (activityCount > lastActivityCountRef.current) {
      const fresh = activity!.slice(0, activityCount - lastActivityCountRef.current);
      lastActivityCountRef.current = activityCount;
      const freshEntries = seedConsoleEntriesFromActivity([...fresh].reverse());
      if (freshEntries.length > 0) {
        setEntries((prev) => appendConsoleEntries(prev, freshEntries));
        setStatus((prev) => ({ ...prev, isLive: true }));
      }
    }
  }, [workItem, activity]);

  useEffect(() => {
    if (!workItemId) return;

    const unsub = wsClient.subscribe((msg) => {
      if (!matchesWorkItemConsole(msg, workItemId)) return;

      if (msg.type === 'work_item:cli_output') {
        setEntries((prev) => {
          const integrated = integrateCliOutput(prev, msg, cliStreamStateRef.current);
          cliStreamStateRef.current = integrated.state;
          return integrated.entries;
        });
        setStatus((prev) => ({
          ...prev,
          isLive: true,
          lastEventAt: msg.timestamp,
          agentType:
            typeof msg.payload.agentType === 'string' ? msg.payload.agentType : prev.agentType,
          phase: typeof msg.payload.phase === 'string' ? msg.payload.phase : prev.phase,
          loopIteration:
            typeof msg.payload.loopIteration === 'number'
              ? msg.payload.loopIteration
              : prev.loopIteration,
        }));
        return;
      }

      const entry = formatWorkItemConsoleEntry(msg);
      if (entry) {
        setEntries((prev) => appendConsoleEntry(prev, entry));
      }
      setStatus((prev) => updateStatusFromMessage(prev, msg));
    });

    return unsub;
  }, [workItemId]);

  useEffect(() => {
    if (!workItem) return;
    const busy = workItem.loopStatus === 'running' || workItem.status === 'in_progress';
    setStatus((prev) => ({
      ...prev,
      loopStatus: workItem.loopStatus,
      loopIteration: workItem.loopIteration,
      maxLoopIterations: workItem.maxLoopIterations,
      isLive: busy || prev.isLive,
    }));
  }, [
    workItem?.loopStatus,
    workItem?.loopIteration,
    workItem?.maxLoopIterations,
    workItem?.status,
  ]);

  const clearConsole = useCallback(() => {
    if (!workItem) return;
    cliStreamStateRef.current = INITIAL_CLI_STREAM_STATE;
    setEntries([consoleWelcomeEntry(workItem.key, workItem.loopStatus)]);
    setSessionKey((k) => k + 1);
  }, [workItem]);

  const idleHint = useMemo(() => {
    if (!workItem) return null;
    if (
      status.isLive ||
      workItem.loopStatus === 'running' ||
      workItem.status === 'in_progress'
    ) {
      return null;
    }
    return 'Idle — run an agent or pipeline to stream live activity.';
  }, [workItem, status.isLive]);

  return {
    entries,
    status,
    sessionKey,
    clearConsole,
    idleHint,
  };
}