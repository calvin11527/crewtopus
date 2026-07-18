/**
 * Integration smoke test: work item agent run streams CLI output over WebSocket.
 */
const API = 'http://localhost:3000/api';
const WS_URL = 'ws://localhost:3000/ws';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const cliEvents = [];
  const allTypes = new Set();

  const ws = new WebSocket(WS_URL);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WebSocket connect timeout')), 5000);
    ws.onopen = () => {
      clearTimeout(t);
      resolve();
    };
    ws.onerror = (e) => {
      clearTimeout(t);
      reject(e);
    };
  });

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    allTypes.add(msg.type);
    if (msg.type === 'work_item:cli_output') {
      cliEvents.push(msg);
    }
  };

  const itemRes = await fetch(`${API}/work-items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'task',
      title: `CLI stream smoke test ${Date.now()}`,
      assignedAgentType: 'mock',
      status: 'todo',
    }),
  });
  if (!itemRes.ok) throw new Error(`create item failed: ${itemRes.status}`);
  const item = await itemRes.json();
  console.log(`Created work item ${item.key} (${item.id})`);

  const runPromise = fetch(`${API}/work-items/${item.id}/run-agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ async: false }),
  });
  await sleep(1500);
  const runRes = await runPromise;
  if (!runRes.ok) throw new Error(`run-agent failed: ${runRes.status} ${await runRes.text()}`);
  const runResult = await runRes.json();
  console.log(`Agent run completed: ${runResult.result.agentType}`);

  await sleep(500);
  ws.close();

  const stdoutChunks = cliEvents.filter((e) => e.payload.stream === 'stdout');
  const combined = stdoutChunks.map((e) => e.payload.chunk).join('');

  console.log('\n--- Results ---');
  console.log(`WS event types seen: ${[...allTypes].sort().join(', ')}`);
  console.log(`work_item:cli_output events: ${cliEvents.length}`);
  console.log(`stdout chunks: ${stdoutChunks.length}`);
  console.log(`combined stdout preview: ${combined.slice(0, 200).replace(/\n/g, '\\n')}`);

  if (cliEvents.length === 0) {
    console.error('FAIL: no work_item:cli_output events received');
    process.exit(1);
  }
  if (!combined.includes('mock-agent')) {
    console.error('FAIL: stdout missing mock-agent marker');
    process.exit(1);
  }
  if (!allTypes.has('work_item:activity')) {
    console.error('FAIL: expected work_item:activity events');
    process.exit(1);
  }

  console.log('PASS: live CLI streaming works end-to-end');
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});