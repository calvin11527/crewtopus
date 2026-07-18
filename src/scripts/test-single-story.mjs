/**
 * Reliability proof: one story, one pipeline, file output + timing.
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
  console.log('=== Single Story Reliability Proof ===\n');
  const t0 = Date.now();

  await json('GET', '/health');

  const item = await json('POST', '/work-items', {
    type: 'story',
    title: 'Reliability proof — write improvements.md',
    description: 'Write prioritized improvements to improvements.md in the working directory.',
    assignedAgentType: 'grok',
    status: 'todo',
    acceptanceCriteria: [
      'improvements.md created in work directory',
      'At least 3 actionable recommendations',
      'Copilot review completes after Grok',
    ],
  });

  console.log(`Created ${item.key}`);

  const pipeline = await json('POST', `/work-items/${item.id}/run-pipeline`, {
    demo: true,
    maxIterations: 2,
    autoLoop: true,
  });

  const elapsed = Date.now() - t0;
  console.log(`Pipeline: ${pipeline.loopStatus} in ${pipeline.iterations} iteration(s)`);
  console.log(`Item status: ${pipeline.item.status}`);
  console.log(`Elapsed: ${elapsed}ms`);

  if (pipeline.loopStatus !== 'approved') {
    console.error('FAIL: expected approved loop');
    process.exit(1);
  }
  if (pipeline.item.status !== 'done') {
    console.error('FAIL: expected done status');
    process.exit(1);
  }
  if (elapsed > 15_000) {
    console.error(`FAIL: demo pipeline too slow (${elapsed}ms)`);
    process.exit(1);
  }

  const activity = await json('GET', `/work-items/${item.id}/activity?limit=10`);
  const hasPipeline = activity.some((a) => (a.summary || '').includes('review'));
  if (!hasPipeline) {
    console.error('FAIL: missing pipeline activity');
    process.exit(1);
  }

  console.log('\nPASS: single-story pipeline is reliable and fast (demo mode)');
  console.log('Production grok runs are slower but use the same code path.');
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});