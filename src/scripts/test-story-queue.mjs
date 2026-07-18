/**
 * Serial story queue proof: story 2 starts only after story 1 finishes.
 */
const API = 'http://localhost:3000/api';

async function json(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  console.log('=== Serial Story Queue Proof ===\n');
  const t0 = Date.now();

  const sprint = await json('POST', '/work-items/sprints', {
    name: `Queue proof ${Date.now()}`,
    goal: 'Run stories one-after-another',
    status: 'active',
  });

  const specs = [
    { title: 'Queue step 1 — improvements.md', file: 'improvements' },
    { title: 'Queue step 2 — automation-checklist.md', file: 'checklist' },
    { title: 'Queue step 3 — pipeline-verification.md', file: 'pipeline' },
  ];

  for (const spec of specs) {
    await json('POST', '/work-items', {
      type: 'task',
      title: spec.title,
      sprintId: sprint.id,
      assignedAgentType: 'grok',
      status: 'todo',
      acceptanceCriteria: [
        spec.file.includes('improvements')
          ? 'improvements.md created in work directory'
          : spec.file.includes('checklist')
            ? 'automation-checklist.md created in work directory'
            : 'pipeline-verification.md created in work directory',
        'Copilot review completes after Grok',
      ],
    });
  }

  const result = await json('POST', `/work-items/sprints/${sprint.id}/run-queue`, {
    demo: true,
    maxIterations: 2,
    autoLoop: true,
    async: false,
  });

  const elapsed = Date.now() - t0;
  console.log(`Queue ${result.queueId}: ${result.status}`);
  console.log(`Approved ${result.totals.approved}/${result.totals.total} in ${elapsed}ms\n`);

  for (const r of result.results) {
    const loop = r.pipeline?.loopStatus || r.error || r.skipReason;
    console.log(`  ${r.item.key} → ${r.item.status} (${loop}) ${r.durationMs ?? 0}ms`);
  }

  if (result.totals.approved !== specs.length) {
    console.error(`\nFAIL: expected ${specs.length} approved, got ${result.totals.approved}`);
    process.exit(1);
  }
  if (elapsed > 20_000) {
    console.error(`\nFAIL: queue too slow (${elapsed}ms)`);
    process.exit(1);
  }

  console.log('\nPASS: serial story queue runs next only after previous finishes');
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});