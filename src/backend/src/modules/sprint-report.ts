/**
 * Sprint success / activity report for sharing and case studies.
 */
import { getSprint, listWorkItems, listWorkItemActivity } from './work-items';
import { getSprintTeamView, getSprintAutomationStatus } from './sprint-team';
import { getAgentCreditUsage } from './agent-credits';
import { listImprovementSuggestions } from './capability-learning';

export interface SprintReport {
  generatedAt: string;
  sprint: {
    id: string;
    name: string;
    goal?: string;
    status: string;
    startDate?: string;
    endDate?: string;
  };
  totals: {
    items: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
    done: number;
    inProgress: number;
    points: number;
    pointsDone: number;
  };
  team: Array<{ role: string; agentName?: string; agentType?: string }>;
  automation?: { mode: string; pausedReason?: string | null };
  recentActivity: Array<{
    workItemKey?: string;
    summary: string;
    agentType?: string;
    createdAt: string;
  }>;
  usageSnapshot: Array<{
    agentType: string;
    percentageUsed: number;
    overBudget: boolean;
    trackingSource?: string;
  }>;
  openSuggestions: number;
  markdown: string;
}

export function buildSprintReport(sprintId: string): SprintReport | null {
  const sprint = getSprint(sprintId);
  if (!sprint) return null;

  const items = listWorkItems({ sprintId });
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let points = 0;
  let pointsDone = 0;
  let done = 0;
  let inProgress = 0;

  for (const item of items) {
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
    byType[item.type] = (byType[item.type] || 0) + 1;
    const pts = item.storyPoints || 0;
    points += pts;
    if (item.status === 'done') {
      done += 1;
      pointsDone += pts;
    }
    if (item.status === 'in_progress' || item.status === 'in_review') inProgress += 1;
  }

  const teamView = getSprintTeamView(sprintId);
  const automation = getSprintAutomationStatus(sprintId);

  const activity: SprintReport['recentActivity'] = [];
  for (const item of items.slice(0, 40)) {
    const acts = listWorkItemActivity(item.id, 5);
    for (const a of acts) {
      activity.push({
        workItemKey: item.key,
        summary: a.summary,
        agentType: a.agentType,
        createdAt: a.createdAt,
      });
    }
  }
  activity.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const recentActivity = activity.slice(0, 25);

  const usageSnapshot = getAgentCreditUsage().map((u) => ({
    agentType: u.agentType,
    percentageUsed: u.percentageUsed,
    overBudget: u.overBudget,
    trackingSource: u.trackingSource,
  }));

  const openSuggestions = listImprovementSuggestions('open').length;

  const md = [
    `# Sprint report: ${sprint.name}`,
    ``,
    `Generated: ${new Date().toISOString()}`,
    ``,
    `## Goal`,
    sprint.goal?.trim() || '_No goal set_',
    ``,
    `## Totals`,
    `- Items: **${items.length}** (${done} done, ${inProgress} in flight)`,
    `- Story points: **${pointsDone}/${points}** done`,
    `- Status: ${Object.entries(byStatus)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')}`,
    ``,
    `## Team`,
    ...(teamView.members.length
      ? teamView.members.map(
          (m) => `- **${m.role}**: ${m.agentName ?? m.agentId} (${m.agentType ?? '?'})`
        )
      : ['- _No team staffed_']),
    ``,
    `## Recent activity`,
    ...(recentActivity.length
      ? recentActivity.map(
          (a) =>
            `- \`${a.createdAt.slice(0, 19)}\` ${a.workItemKey ?? ''} ${a.summary}${
              a.agentType ? ` _(${a.agentType})_` : ''
            }`
        )
      : ['- _No activity yet_']),
    ``,
    `## Why this matters`,
    `Crewtopus keeps a **process trail** (board + roles + audit) — not just a chat transcript.`,
    ``,
  ].join('\n');

  return {
    generatedAt: new Date().toISOString(),
    sprint: {
      id: sprint.id,
      name: sprint.name,
      goal: sprint.goal,
      status: sprint.status,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
    },
    totals: {
      items: items.length,
      byStatus,
      byType,
      done,
      inProgress,
      points,
      pointsDone,
    },
    team: teamView.members.map((m) => ({
      role: m.role,
      agentName: m.agentName,
      agentType: m.agentType,
    })),
    automation: {
      mode: automation.automation?.mode ?? 'paused',
      pausedReason: automation.automation?.pausedReason ?? null,
    },
    recentActivity,
    usageSnapshot,
    openSuggestions,
    markdown: md,
  };
}
