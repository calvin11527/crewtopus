import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'ui-screenshots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto('http://localhost:5173/board', { waitUntil: 'networkidle', timeout: 15000 });
const card = page.locator('.kanban-card').first();
if (await card.count()) await card.click();
await page.waitForTimeout(800);

// Seed many console lines via run if possible - skip, just check layout metrics
const metrics = await page.evaluate(() => {
  const pane = document.querySelector('.board-detail-pane');
  const console = document.querySelector('.agent-console');
  const log = document.querySelector('.scroll-terminal');
  const body = document.querySelector('.board-detail-body');
  const r = (el) => (el ? el.getBoundingClientRect() : null);
  const cs = (el) => (el ? getComputedStyle(el) : null);
  return {
    pane: r(pane),
    console: r(console),
    log: r(log),
    body: r(body),
    logOverflow: cs(log)?.overflowY,
    bodyOverflow: cs(body)?.overflowY,
    paneOverflow: cs(pane)?.overflow,
    resizeHandle: !!document.querySelector('.board-detail-resize-handle'),
    consoleResize: !!document.querySelector('.agent-console-resize-handle'),
  };
});

await page.screenshot({ path: path.join(outDir, 'board_detail_fixed.png'), fullPage: false });
await browser.close();

console.log(JSON.stringify(metrics, null, 2));
console.log(`Screenshot: ${path.join(outDir, 'board_detail_fixed.png')}`);
