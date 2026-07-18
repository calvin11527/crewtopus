import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, 'ui-screenshots');
fs.mkdirSync(outDir, { recursive: true });

const consoleLogs = [];
const pageErrors = [];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on('console', (msg) => {
  consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
});
page.on('pageerror', (err) => {
  pageErrors.push(`${err.message}\n${err.stack ?? ''}`);
});

for (const route of ['/', '/board', '/workflows']) {
  await page.goto(`http://localhost:5173${route}`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, `${route.replace(/\//g, '_') || 'home'}.png`), fullPage: true });
}

// Open a board card if present
await page.goto('http://localhost:5173/board', { waitUntil: 'networkidle' });
const card = page.locator('.kanban-card').first();
if (await card.count()) {
  await card.click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(outDir, 'board_with_detail.png'), fullPage: true });
}

const layout = await page.evaluate(() => {
  const sidebar = document.querySelector('.sidebar');
  const main = document.querySelector('.main-content');
  const board = document.querySelector('.kanban-board');
  const detail = document.querySelector('.board-detail-pane');
  const rect = (el) => (el ? el.getBoundingClientRect() : null);
  return {
    sidebar: rect(sidebar),
    main: rect(main),
    board: rect(board),
    detail: rect(detail),
    boardLayout: document.querySelector('.board-layout')?.className,
    mainOverflow: main ? getComputedStyle(main).overflow : null,
    bodyOverflow: getComputedStyle(document.body).overflow,
  };
});

await browser.close();

console.log('--- Layout metrics ---');
console.log(JSON.stringify(layout, null, 2));
console.log('\n--- Page errors ---');
console.log(pageErrors.length ? pageErrors.join('\n') : '(none)');
console.log('\n--- Console (errors/warnings) ---');
const important = consoleLogs.filter((l) => /error|warn|failed/i.test(l));
console.log(important.length ? important.join('\n') : '(none)');
console.log(`\nScreenshots saved to ${outDir}`);