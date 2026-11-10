// Drives the REAL web UI in headless Chrome against the local demo stack (scripts/demo-local.sh) with an injected
// EIP-1193 wallet backed by an anvil dev account. Proves: connect → vote → tally/feed update, rail act, nominate path, mobile layout.
// usage: node scripts/ui-e2e.mjs [http://127.0.0.1:5173]
import { chromium } from 'playwright-core';
import { createRequire } from 'node:module';
const WEB = process.argv[2] ?? 'http://127.0.0.1:5173';
const RPC = 'http://127.0.0.1:8545';
const ACCT = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc'; // anvil #5
const WIF = '0x5173b8eA6923c2d40267890D45C46a3480954773';
const rpc = (method, params) => fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json());
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

// fund the test wallet: ETH + 10 WIF (OZ balance slot 0)
await rpc('anvil_setBalance', [ACCT, '0x56bc75e2d63100000']);
const { keccak256, encodeAbiParameters } = await import('viem');
const slot = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [ACCT, 0n]));
await rpc('anvil_setStorageAt', [WIF, slot, '0x' + (10n * 10n ** 18n).toString(16).padStart(64, '0')]);

const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(({ ACCT, RPC }) => {
  const call = (method, params) => fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: (window.__id = (window.__id || 0) + 1), method, params }) }).then((r) => r.json()).then((j) => { if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; throw e; } return j.result; });
  const provider = {
    request: async ({ method, params }) => {
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [ACCT];
      if (method === 'wallet_switchEthereumChain') return null;
      return call(method, params);
    },
    on() {}, removeListener() {},
  };
  window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { uuid: 'test', name: 'Test Wallet', icon: '', rdns: 'test.wallet' }, provider } })));
}, { ACCT, RPC });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(WEB + '/#/e/3?vote=0');
await page.waitForSelector('text=Should vote cost go up', { timeout: 20000 });
console.log('election room');
const before = await page.locator('.opt .n').first().innerText();
ok(await page.locator('.opt[aria-pressed="true"]').count() === 1, '?vote=0 preselects option A');
await page.waitForTimeout(800);
await page.locator('.top').getByRole('button', { name: /Connect wallet/ }).click();
await page.getByRole('button', { name: /Test Wallet/ }).click();
await page.waitForTimeout(1500);
console.log('   header:', (await page.locator('.top').innerText()).replace(/\n/g, ' | '), '| modal:', await page.locator('.modal').count() ? (await page.locator('.modal').innerText()).replace(/\n/g,' ') : 'closed');
await page.waitForSelector('.top .btn.ghost.sm', { timeout: 5000 });
ok(true, 'wallet connected through EIP-6963');
await page.getByRole('button', { name: /Burn 1 \$WIF · vote A/ }).click();
await page.waitForSelector('text=You voted A', { timeout: 25000 }).catch(async () => { console.log('   status:', await page.locator('.err, .small.muted:has-text("⏳")').allInnerTexts()); await page.screenshot({ path: '/tmp/ui-fail.png' }); throw new Error('vote did not confirm'); });
ok(true, 'vote tx confirmed; UI shows "You voted A"');
const after = await page.locator('.opt .n').first().innerText();
ok(after !== before, `tally moved: ${before.replace(/\s+/g, ' ')} → ${after.replace(/\s+/g, ' ')}`);
await page.waitForSelector(`.feed li:first-child:has-text("${ACCT.slice(0, 6)}")`, { timeout: 20000 });
ok(true, 'live feed shows the new vote at the top');
await page.screenshot({ path: '/tmp/ui-voted.png', fullPage: true });

console.log('rail');
await page.goto(WEB + '/#/rails');
await page.waitForSelector('#gate-1');
await page.locator('#gate-1').getByRole('button', { name: /Sign · burn 1/ }).click();
await page.waitForSelector("#gate-1 >> text=You’re #", { timeout: 40000 });
ok(true, 'petition signed; position shown');

console.log('deposit path UI');
await page.goto(WEB + '/#/e/2');
await page.waitForSelector('.opt');
await page.locator('.opt').nth(1).click();
await page.getByRole('button', { name: /Just send 1 \$WIF/ }).click();
const addr = await page.locator('.addr').filter({ hasText: /^0x[0-9a-fA-F]{40}$/ }).first().innerText();
ok(/^0x[0-9a-fA-F]{40}$/.test(addr), `deposit address shown for option B: ${addr}`);
await page.getByRole('button', { name: /Pay from connected wallet/ }).click();
await page.waitForSelector('text=view transaction', { timeout: 40000 });
ok(true, 'plain 1 WIF transfer sent from the UI');

console.log('mobile');
const m = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const mp = await m.newPage();
await mp.goto(WEB + '/#/e/1');
await mp.waitForSelector('.opt');
const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok(overflow <= 1, `no horizontal overflow on a 390px phone (delta ${overflow}px)`);
ok(await mp.locator('.tabbar').isVisible(), 'bottom tab bar visible on mobile');
for (const r of ['', 'elections', 'basket', 'rails', 'leaderboard', 'create', 'build']) {
  await mp.goto(`${WEB}/#/${r}`); await mp.waitForTimeout(700);
  const o = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(o <= 1, `#/${r || 'home'} fits mobile (delta ${o}px)`);
}
await b.close();
ok(errs.length === 0, 'no uncaught page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
console.log(fails ? `\n❌ ${fails} UI checks failed` : '\n✅ UI E2E PASSED');
process.exit(fails ? 1 : 0);
