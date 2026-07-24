/**
 * Cold-start mock demo — no Grok/Copilot/Claude CLIs required.
 *
 * Prerequisites: backend at http://localhost:3000 (npm run dev).
 *
 * Creates a story, runs the mock implement → test → review pipeline,
 * and prints board URL + result summary.
 */
const API = process.env.CREWTOPUS_API || 'http://localhost:3000/api';
const UI = process.env.CREWTOPUS_UI || 'http://localhost:5173';
const TIMEOUT_MS = Number(process.env.CREWTOPUS_DEMO_TIMEOUT_MS || 60_000);

async function json(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function waitForHealth(maxMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const h = await json('GET', '/health');
      if (h?.status === 'ok' || h?.database) return h;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `Backend not ready at ${API}. Start with: cd src && npm run dev\n` +
      `(or npm run setup && npm run dev)`
  );
}

async function main() {
  console.log('🐙 Crewtopus mock demo (no paid CLIs required)\n');

  await waitForHealth();
  console.log('✓ Backend healthy');

  // Prefer active sprint if present
  let sprintId;
  try {
    const sprints = await json('GET', '/work-items/sprints');
    const active = Array.isArray(sprints)
      ? sprints.find((s) => s.status === 'active') || sprints[0]
      : null;
    sprintId = active?.id;
    if (active) console.log(`✓ Using sprint: ${active.name}`);
  } catch {
    /* optional */
  }

  if (!sprintId) {
    const sprint = await json('POST', '/work-items/sprints', {
      name: 'Welcome Demo Sprint',
      goal: 'See a mock multi-agent pipeline complete end-to-end',
      status: 'active',
    });
    sprintId = sprint.id;
    console.log(`✓ Created sprint: ${sprint.name}`);
  }

  const item = await json('POST', '/work-items', {
    type: 'story',
    title: 'Demo: mock crew implements a small improvement',
    description:
      'Welcome story for new users. The mock adapter will implement → test → review ' +
      'without any external CLI. Write a short note to improvements.md if a work dir is available.',
    sprintId,
    assignedAgentType: 'mock',
    status: 'todo',
    priority: 'high',
    storyPoints: 1,
    acceptanceCriteria: [
      'Mock implementation step completes',
      'Mock test step reports PASS',
      'Mock review returns APPROVED',
      'Story ends in done (or in_review after pipeline)',
    ],
  });
  console.log(`✓ Created ${item.key}: ${item.title}`);

  const t0 = Date.now();
  console.log('→ Running mock pipeline (implement → test → review)…');

  // Synchronous run so CLI demo prints a real result (async defaults to job queue).
  const pipeline = await json('POST', `/work-items/${item.id}/run-pipeline`, {
    demo: true,
    maxIterations: 1,
    autoLoop: true,
    async: false,
  });

  const elapsed = Date.now() - t0;
  console.log(`\n✓ Pipeline finished in ${elapsed}ms`);
  console.log(`  loopStatus: ${pipeline.loopStatus}`);
  console.log(`  item.status: ${pipeline.item?.status}`);
  console.log(`  iterations: ${pipeline.iterations}`);
  console.log(`  reviewVerdict: ${pipeline.reviewVerdict}`);

  if (pipeline.steps?.length) {
    console.log('\n  Steps:');
    for (const s of pipeline.steps) {
      console.log(`    - ${s.phase || s.name} (${s.agentType})`);
    }
  }

  const ok =
    pipeline.loopStatus === 'approved' &&
    pipeline.item?.status === 'done' &&
    pipeline.reviewVerdict === 'approved';

  console.log(
    `\n${ok ? 'PASS' : 'FAIL'}: expected loopStatus=approved, status=done, reviewVerdict=approved`
  );
  console.log(`  UI:    ${UI}/board`);
  console.log(`  Story: ${UI}/board (select ${item.key})`);
  console.log(`\nNext: staff real adapters (Grok / Copilot / Claude / Ollama) on Agents,`);
  console.log('then run Full lifecycle on a real repo workspace.\n');

  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error('\nFAIL:', err.message);
  process.exit(1);
});
