/**
 * End-to-end proof: improvement epic → child pipelines → rollup summary.
 * Requires backend at localhost:3000. Uses mock fallback when Grok/Copilot CLIs are absent.
 */
const API = 'http://localhost:3000/api';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function json(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

async function main() {
  console.log('=== AgentHub Epic Workflow E2E ===\n');

  const health = await json('GET', '/health');
  console.log(`Backend healthy (uptime ${health.uptime}s)`);

  const workspaces = await json('GET', '/workspaces');
  const workspaceId = workspaces.find((w) => /improvement|agenthub/i.test(w.name))?.id ?? workspaces[0]?.id;
  console.log(`Using workspace: ${workspaceId || '(none)'}`);

  const bundle = await json('POST', '/work-items/epics/improvement', {
    workspaceId,
    sprintName: `Automation proof ${new Date().toISOString().slice(0, 16)}`,
  });

  console.log(`\nCreated epic ${bundle.epic.key}: ${bundle.epic.title}`);
  console.log(`Children: ${bundle.children.map((c) => c.key).join(', ')}`);
  console.log(`Workflow: ${bundle.workflowId}`);

  const demo = process.env.AGENTHUB_EPIC_DEMO !== 'false';
  console.log(`Pipeline mode: ${demo ? 'demo (mock agents)' : 'production (grok→copilot)'}`);

  const run = await json('POST', `/work-items/epics/${bundle.epic.id}/run`, {
    maxIterations: 2,
    autoLoop: true,
    stopOnFailure: false,
    demo,
  });

  console.log('\n--- Orchestration results ---');
  for (const child of run.childResults) {
    const status = child.pipeline?.loopStatus || child.error || child.skipReason || 'unknown';
    console.log(`  ${child.item.key} [${child.item.status}] loop=${status} dir=${child.workDir}`);
  }

  const summary = await json('GET', `/work-items/epics/${bundle.epic.id}/summary`);
  console.log('\n--- Epic summary ---');
  console.log(`  Epic ${summary.epic.key}: ${summary.epic.status}`);
  console.log(`  Done ${summary.totals.done}/${summary.totals.children}`);
  console.log(`  Points ${summary.totals.completedPoints}/${summary.totals.storyPoints}`);

  const activity = await json('GET', `/work-items/${bundle.epic.id}/activity?limit=20`);
  const orchestrationEvents = activity.filter((a) =>
    (a.summary || '').includes('orchestration') || (a.metadata?.event || '').includes('epic_orchestration')
  );
  console.log(`  Epic activity events: ${orchestrationEvents.length}`);

  const failures = run.childResults.filter((r) => r.error);
  const approved = run.childResults.filter((r) => r.pipeline?.loopStatus === 'approved');

  if (failures.length > 0) {
    console.error('\nFAIL: child pipeline errors');
    failures.forEach((f) => console.error(`  ${f.item.key}: ${f.error}`));
    process.exit(1);
  }

  if (approved.length !== bundle.children.length) {
    console.error(`\nFAIL: expected ${bundle.children.length} approved children, got ${approved.length}`);
    process.exit(1);
  }

  if (summary.epic.status !== 'done') {
    console.error(`\nFAIL: epic status is ${summary.epic.status}, expected done`);
    process.exit(1);
  }

  if (orchestrationEvents.length < 2) {
    console.error('\nFAIL: expected epic orchestration activity events');
    process.exit(1);
  }

  console.log('\nPASS: improvement epic automation works end-to-end');
  console.log(`Open the board and filter sprint "${bundle.sprint.name}" to inspect ${bundle.epic.key}.`);
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});