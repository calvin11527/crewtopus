import { useEffect, useState } from 'react';
import type { WorkItem } from '../types';

export function useTickingNow(enabled: boolean): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [enabled]);
  return nowMs;
}

export type LoopJobLite = {
  id: string;
  workItemId?: string;
  status: string;
  jobType?: string;
  error?: string;
  createdAt?: string;
  startedAt?: string;
};

export type NowSeverity = 'working' | 'waiting' | 'needs_you' | 'failed';
export type NowCta = 'run' | 'approve' | 'retry' | 'cancel' | null;

export interface WorkItemNow {
  visible: boolean;
  title: string;
  detail: string;
  elapsedLabel: string | null;
  severity: NowSeverity;
  cta: NowCta;
  phaseLabel: string;
  waitReason: string;
  jobStatus: string | null;
  cardLine: string;
  bannerLine: string;
}

const STUCK_SOFT_MS = 45_000;
const STUCK_HARD_MS = 180_000;

export function formatElapsed(fromIso: string, nowMs = Date.now()): string {
  const start = new Date(fromIso).getTime();
  if (!Number.isFinite(start)) return '';
  const s = Math.max(0, Math.floor((nowMs - start) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function jobPhaseLabel(jobType?: string): string {
  if (jobType === 'story_ba') return 'Business analyst';
  if (jobType === 'story_pm') return 'Project manager';
  if (jobType === 'work_item_pipeline') return 'Developer pipeline';
  if (jobType === 'work_item_agent') return 'Agent run';
  return 'Agent job';
}

function since(job: LoopJobLite | null | undefined): string | undefined {
  return job?.startedAt || job?.createdAt;
}

export function deriveWorkItemNow(input: {
  item: Pick<WorkItem, 'key' | 'status' | 'loopStatus' | 'assignedAgentType'>;
  job?: LoopJobLite | null;
  hasCliOutput?: boolean;
  nowMs?: number;
}): WorkItemNow {
  const nowMs = input.nowMs ?? Date.now();
  const job = input.job ?? null;
  const agent = input.item.assignedAgentType;
  const phase = jobPhaseLabel(job?.jobType);
  const elapsedFrom = since(job);
  const elapsedLabel = elapsedFrom ? formatElapsed(elapsedFrom, nowMs) : null;
  const elapsedMs = elapsedFrom ? Math.max(0, nowMs - new Date(elapsedFrom).getTime()) : 0;
  const agentBit = agent ? agent : 'agent';

  const hidden = (): WorkItemNow => ({
    visible: false,
    title: '',
    detail: '',
    elapsedLabel: null,
    severity: 'waiting',
    cta: null,
    phaseLabel: phase,
    waitReason: '',
    jobStatus: job?.status ?? null,
    cardLine: '',
    bannerLine: '',
  });

  if (input.item.loopStatus === 'awaiting_approval' || job?.status === 'awaiting_approval') {
    return {
      visible: true,
      title: 'Paused — your approval',
      detail: `${phase} is waiting on Privacy & Security before it can talk to ${agentBit}.`,
      elapsedLabel,
      severity: 'needs_you',
      cta: 'approve',
      phaseLabel: phase,
      waitReason: 'Needs approval',
      jobStatus: 'awaiting_approval',
      cardLine: 'Needs approval',
      bannerLine: `${input.item.key} needs approval to continue ${phase.toLowerCase()}`,
    };
  }

  if (job?.status === 'failed' || input.item.loopStatus === 'failed') {
    const err = job?.error?.trim() || 'The last run stopped.';
    return {
      visible: true,
      title: 'Stopped',
      detail: err,
      elapsedLabel,
      severity: 'failed',
      cta: 'retry',
      phaseLabel: phase,
      waitReason: 'Failed',
      jobStatus: 'failed',
      cardLine: 'Stopped',
      bannerLine: `${input.item.key} stopped: ${err.slice(0, 80)}`,
    };
  }

  if (input.item.loopStatus === 'awaiting_shift') {
    return {
      visible: true,
      title: 'Waiting for the next shift',
      detail: `${phase} will resume when the staffed agent is on shift.`,
      elapsedLabel,
      severity: 'waiting',
      cta: null,
      phaseLabel: phase,
      waitReason: 'Awaiting shift',
      jobStatus: job?.status ?? 'awaiting_shift',
      cardLine: 'Awaiting shift',
      bannerLine: `${input.item.key} is waiting for the next shift`,
    };
  }

  if (job?.status === 'pending') {
    return {
      visible: true,
      title: `${phase} in queue`,
      detail: `Waiting for a worker to pick this up · ${agentBit}`,
      elapsedLabel,
      severity: 'working',
      cta: null,
      phaseLabel: phase,
      waitReason: 'Waiting for a worker',
      jobStatus: 'pending',
      cardLine: `${shortPhase(job.jobType)} · queued${elapsedLabel ? ` ${elapsedLabel}` : ''}`,
      bannerLine: `${phase} queued on ${input.item.key}${elapsedLabel ? ` · ${elapsedLabel}` : ''}`,
    };
  }

  if (job?.status === 'running' || input.item.loopStatus === 'running' || input.item.status === 'in_progress') {
    const silent = job?.status === 'running' && !input.hasCliOutput;
    let waitReason = input.hasCliOutput ? 'Live output on Run' : `Starting ${agentBit}`;
    let title = input.hasCliOutput ? `${agentBit} is working` : `Starting ${agentBit}`;
    let detail = `${phase}${input.hasCliOutput ? ' · live on the Run tab' : ' · waiting for the first CLI output'}`;
    let severity: NowSeverity = 'working';

    if (silent && elapsedMs >= STUCK_HARD_MS) {
      waitReason = 'No CLI output yet';
      title = 'Still starting — no CLI output yet';
      detail = `${phase} has been running for ${elapsedLabel || 'a while'} with no console output. It may be hung.`;
      severity = 'needs_you';
    } else if (silent && elapsedMs >= STUCK_SOFT_MS) {
      waitReason = 'No CLI output yet';
      title = 'Still starting — no CLI output yet';
      detail = `${phase} is running, but Grok has not printed anything yet.`;
    }

    if (!job && input.item.status === 'in_progress' && input.item.loopStatus === 'idle') {
      waitReason = 'In progress';
      title = `${phase} in progress`;
      detail = 'Work is marked in progress. Waiting for a live job signal…';
    }

    return {
      visible: true,
      title,
      detail,
      elapsedLabel,
      severity,
      cta: job?.status === 'running' ? 'cancel' : null,
      phaseLabel: phase,
      waitReason,
      jobStatus: job?.status ?? 'running',
      cardLine: `${shortPhase(job?.jobType)} · ${input.hasCliOutput ? 'running' : 'starting'}${elapsedLabel ? ` ${elapsedLabel}` : ''}`,
      bannerLine: `${title} on ${input.item.key}${elapsedLabel ? ` · ${elapsedLabel}` : ''}`,
    };
  }

  return hidden();
}

function shortPhase(jobType?: string): string {
  if (jobType === 'story_ba') return 'BA';
  if (jobType === 'story_pm') return 'PM';
  if (jobType === 'work_item_pipeline') return 'Pipeline';
  if (jobType === 'work_item_agent') return 'Agent';
  return 'Job';
}

export function isLiveJobStatus(status?: string): boolean {
  return status === 'pending' || status === 'running' || status === 'awaiting_approval';
}
