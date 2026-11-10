// Phase 1 UI check on the local fork: create an election WITH option images through the real UI (injected wallet),
// verify upload/serve/strip, picture cards, burn hero. usage: node scripts/ui-images.mjs http://127.0.0.1:5174 [shots]
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const WEB = process.argv[2] ?? 'http://127.0.0.1:5174';
const SHOTS = process.argv[3] === 'shots';
const OUT = new URL('../docs/screens/', import.meta.url).pathname;
const RPC = 'http://127.0.0.1:8545';
const ACCT = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc';
const WIF = '0x5173b8eA6923c2d40267890D45C46a3480954773';
const rpc = (method, params) => fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json());
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
await rpc('anvil_setBalance', [ACCT, '0x56bc75e2d63100000']);
const { keccak256, encodeAbiParameters } = await import('viem');
await rpc('anvil_setStorageAt', [WIF, keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [ACCT, 0n])), '0x' + (10n * 10n ** 18n).toString(16).padStart(64, '0')]);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const mk = async (w, h, wallet = true, mobile = false) => {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: SHOTS ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  if (wallet) await ctx.addInitScript(({ ACCT, RPC }) => {
    const call = (method, params) => fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: (window.__id = (window.__id || 0) + 1), method, params }) }).then((r) => r.json()).then((j) => { if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; throw e; } return j.result; });
    const provider = { request: async ({ method, params }) => (method === 'eth_requestAccounts' || method === 'eth_accounts') ? [ACCT] : method === 'wallet_switchEthereumChain' ? null : call(method, params), on() {}, removeListener() {} };
    window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { uuid: 'test', name: 'Test Wallet', icon: '', rdns: 'test.wallet' }, provider } })));
  }, { ACCT, RPC });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  return { ctx, p, errs };
};
const shot = async (p, name, full = false) => { if (SHOTS) { await p.waitForTimeout(1500); await p.screenshot({ path: OUT + name, fullPage: full }); } };

let { p, errs } = await mk(1280, 900);
console.log('home hero');
await p.goto(WEB + '/#/');
await p.waitForSelector('.burnhero .big');
await p.waitForTimeout(1500);
const burn = await p.locator('.burnhero .big').innerText();
ok(/\d/.test(burn), 'burn hero shows a number: ' + burn.replace(/\s+/g, ' '));
ok(await p.locator('.burnpill').count() === 1, 'header burn pill present');
await shot(p, '14-home-burn-counter-desktop.png');

console.log('create with images');
await p.goto(WEB + '/#/create');
await p.waitForSelector('text=Add image');
await p.locator('input[placeholder="Which Stock Token should the world buy first?"]').fill('Which logo wins?');
await p.locator('input[placeholder="Option A"]').fill('Sun');
await p.locator('input[placeholder="Option B"]').fill('Sea');
const pick = async (idx, f) => { const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByRole('button', { name: /Add image/ }).first().click()]); await fc.setFiles(f); };
await pick(0, '/tmp/test-a.jpg');
await p.waitForSelector('.thumb-edit img');
await pick(1, '/tmp/test-b.jpg');
await p.waitForFunction(() => document.querySelectorAll('.thumb-edit img').length === 2);
ok(true, 'two images picked and previewed (client downscale)');
await shot(p, '15-create-with-images-desktop.png', true);
await p.locator('.top').getByRole('button', { name: /Connect wallet/ }).click();
await p.getByRole('button', { name: /Test Wallet/ }).click();
await p.waitForSelector('.top .btn.ghost.sm');
await p.getByRole('button', { name: /Create election/ }).click();
await p.waitForFunction(() => /#\/e\/\d+/.test(location.hash), null, { timeout: 60000 }).catch(async (e) => { console.log('   status:', await p.locator('.err, .small.muted').allInnerTexts()); throw e; });
const id = (await p.evaluate(() => location.hash)).match(/#\/e\/(\d+)/)[1];
ok(true, 'election #' + id + ' created with images');
await p.waitForSelector('.opt .pic', { timeout: 20000 });
ok(await p.locator('.opt .pic').count() === 2, 'room shows 2 picture cards');
const srcs = await p.locator('.opt .pic').evaluateAll((l) => l.map((i) => i.getAttribute('src')));
for (const s of srcs) {
  const r = await fetch(WEB + s);
  const buf = Buffer.from(await r.arrayBuffer());
  ok(r.ok && /image\/(webp|jpeg)/.test(r.headers.get('content-type')) && r.headers.get('cache-control').includes('immutable'), `GET ${s.slice(0, 18)}… served (${buf.length} B, ${r.headers.get('content-type')}, immutable)`);
  ok(buf.length <= 80 * 1024, 'size <= 80 KB');
  ok(!buf.includes(Buffer.from('SecretCam')) && !buf.includes(Buffer.from('GPS-LEAK')) && !buf.includes(Buffer.from('Exif')) && !buf.includes(Buffer.from('XMP')), 'no EXIF/comment/XMP bytes in the stored image');
  ok(createHash('sha256').update(buf).digest('hex') === s.split('/').pop(), 'URL is the sha256 of the bytes');
}
await shot(p, '16-room-with-images-desktop.png');
await p.goto(WEB + '/#/elections');
await p.waitForSelector('.pics .pic', { timeout: 15000 });
ok(await p.locator('.pics .pic').count() >= 2, 'election list card shows option pictures');
await p.goto(WEB + '/#/');
await p.waitForSelector('.pics .pic', { timeout: 15000 });
ok(true, 'home live list shows pictures');
for (let k = 0; k < 40; k++) { const r = await fetch(`${WEB}/api/elections/${id}`); if (r.ok) break; await new Promise((r) => setTimeout(r, 2000)); }
const share = await (await fetch(`${WEB}/share/${id}`)).text();
ok(share.includes('twitter:card" content="summary"') && /twitter:image" content="[^"]*\/img\/[0-9a-f]{64}"/.test(share), 'share page uses the option image for twitter/og');
const api = await (await fetch(`${WEB}/api/elections/${id}`)).json();
ok(api.options[0].image?.includes('/img/') && api.options[1].image, 'API exposes option images');
ok(errs.length === 0, 'no page errors ' + errs.join('|'));

console.log('phase 2: share composer + one-tap links');
await p.goto(WEB + `/#/e/${id}`);
await p.waitForSelector('#share textarea');
const ta = await p.locator('#share textarea').inputValue();
ok(/Reply or tap to vote: A Sun · B Sea/.test(ta), 'composer prefilled: ' + ta.split('\n')[1]);
const hrefs = await p.locator('#share a.btn').evaluateAll((l) => l.map((a) => a.href));
ok(hrefs[0].startsWith('https://twitter.com/intent/tweet?text=') && hrefs[0].includes(encodeURIComponent('/share/' + id)), 'Post on X intent carries text + share url');
ok(hrefs.some((h) => decodeURIComponent(h).includes(`/v/${id}/1`)), 'per-option X post carries /v/<id>/<opt>');
const vp = await fetch(`${WEB}/v/${id}/1`);
const vh = await vp.text();
ok(vp.status === 200 && vh.includes('Vote Sea') && vh.includes(`#/e/${id}?vote=1`) && vh.includes('A Sun'), '/v/<id>/<opt> preview page: option title, tally in description, redirect to ?vote=1');
ok((await fetch(`${WEB}/v/${id}/9`)).status === 404, '/v/<id>/<bad option> is 404');
await p.goto(WEB + `/#/e/${id}?vote=1`);
await p.waitForSelector('.opt[aria-pressed="true"]');
ok(await p.locator('.opt').nth(1).getAttribute('aria-pressed') === 'true', '?vote=1 preselects option B');
await shot(p, '19-share-composer-desktop.png', true);

console.log('no-image election still renders');
await p.goto(WEB + '/#/e/1');
await p.waitForSelector('.opt');
ok(await p.locator('.opt .pic').count() === 0, 'election without images shows no broken pictures');

console.log('mobile');
const m = await mk(390, 844, false, true);
await m.p.goto(WEB + `/#/`); await m.p.waitForSelector('.burnhero .big'); await m.p.waitForTimeout(1500);
let o = await m.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok(o <= 1, 'home fits a 390px phone with the hero (delta ' + o + ')');
await shot(m.p, '17-home-burn-counter-mobile.png');
await m.p.goto(WEB + `/#/create`); await m.p.waitForSelector('text=Add image'); await m.p.waitForTimeout(500);
o = await m.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok(o <= 1, 'create fits mobile (delta ' + o + ')');
await m.p.goto(WEB + `/#/e/${id}`); await m.p.waitForSelector('.opt .pic'); await m.p.waitForTimeout(500);
o = await m.p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok(o <= 1, 'room with pictures fits mobile (delta ' + o + ')');
await shot(m.p, '18-room-with-images-mobile.png');
await b.close();
console.log(fails ? `\n❌ ${fails} checks failed` : '\n✅ PHASE 1 UI PASSED');
process.exit(fails ? 1 : 0);
