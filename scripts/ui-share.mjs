// Read-only UI checks (no chain writes): share composer, /v/<id>/<opt> pages, picture cards. usage: node scripts/ui-share.mjs <web> <electionId> [shots]
import { chromium } from 'playwright-core';
const [WEB = 'http://127.0.0.1:5174', id = '5', shots] = process.argv.slice(2);
const OUT = new URL('../docs/screens/', import.meta.url).pathname;
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: shots ? 2 : 1 });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(WEB + `/#/e/${id}`);
await p.waitForSelector('#share textarea', { timeout: 30000 });
const ta = await p.locator('#share textarea').inputValue();
ok(/Reply or tap to vote: A .* · B /.test(ta), 'composer prefilled: ' + ta.split('\n')[1]);
const hrefs = await p.locator('#share a.btn').evaluateAll((l) => l.map((a) => a.href));
ok(hrefs[0].startsWith('https://twitter.com/intent/tweet?text=') && hrefs[0].includes(encodeURIComponent('/share/' + id)), 'Post on X intent carries text + share url');
ok(hrefs.some((h) => decodeURIComponent(h).includes(`/v/${id}/1`)), 'per-option X post carries /v/<id>/<opt>');
const vp = await fetch(`${WEB}/v/${id}/1`); const vh = await vp.text();
ok(vp.status === 200 && vh.includes('Vote ') && vh.includes(`#/e/${id}?vote=1`), '/v/<id>/<opt> preview page + redirect to ?vote=1');
ok((await fetch(`${WEB}/v/${id}/99`)).status === 404, '/v/<id>/<bad option> is 404');
await p.goto(WEB + `/#/e/${id}?vote=1`);
await p.waitForSelector('.opt[aria-pressed="true"]');
ok(await p.locator('.opt').nth(1).getAttribute('aria-pressed') === 'true', '?vote=1 preselects option B');
if (shots) { await p.waitForTimeout(1000); await p.locator('#share').screenshot({ path: OUT + '19-share-composer-desktop.png' }); }
ok(errs.length === 0, 'no page errors ' + errs.join('|'));
await b.close();
console.log(fails ? `❌ ${fails} failed` : '✅ SHARE UI PASSED'); process.exit(fails ? 1 : 0);
