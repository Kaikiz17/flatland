// Headless Chrome smoke test of a deployed Flatland URL: node scripts/live-check.mjs https://flatland.flatland.workers.dev (needs playwright-core + /usr/bin/google-chrome)
import { chromium } from 'playwright-core';
const U = process.argv[2];
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const pg = await b.newPage({ viewport: { width: 1200, height: 900 } });
const errs = [];
pg.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 200)));
pg.on('pageerror', (e) => errs.push('pageerror ' + e.message.slice(0, 200)));
const reqs = [];
pg.on('requestfailed', (r) => reqs.push(r.url().slice(0, 100) + ' ' + r.failure()?.errorText));
for (const [name, hash] of [['home', '#/'], ['basket', '#/basket'], ['elections', '#/elections'], ['rails', '#/rails']]) {
  await pg.goto(U + '/' + hash, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => errs.push('goto ' + e.message.slice(0, 100)));
  await pg.waitForTimeout(2500);
  const txt = (await pg.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 350);
  console.log('==', name, txt);
  await pg.screenshot({ path: `/tmp/live-${name}.png` });
}
console.log('errors', errs, 'failed', reqs);
await b.close();
