// Captures polished screenshots of the running local demo (scripts/demo-local.sh) into docs/screens/.
import { chromium } from 'playwright-core';
import { keccak256, encodeAbiParameters } from 'viem';
const WEB = process.argv[2] ?? 'http://127.0.0.1:5173';
const OUT = new URL('../docs/screens/', import.meta.url).pathname;
const RPC = 'http://127.0.0.1:8545';
const ACCT = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc';
const WIF = '0x5173b8eA6923c2d40267890D45C46a3480954773';
const rpc = (method, params) => fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json());
const giveWif = (a, n) => rpc('anvil_setStorageAt', [WIF, keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [a, 0n])), '0x' + (n * 10n ** 18n).toString(16).padStart(64, '0')]);
await rpc('anvil_setBalance', [ACCT, '0x56bc75e2d63100000']); await giveWif(ACCT, 10n);
const ONLY = (process.env.ONLY ?? '').split(',').filter(Boolean);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const mk = async (w, h, wallet) => {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  if (wallet) await ctx.addInitScript(({ ACCT, RPC }) => {
    const call = (method, params) => fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: (window.__id = (window.__id || 0) + 1), method, params }) }).then((r) => r.json()).then((j) => { if (j.error) throw new Error(j.error.message); return j.result; });
    const provider = { request: async ({ method, params }) => (method === 'eth_requestAccounts' || method === 'eth_accounts') ? [ACCT] : method === 'wallet_switchEthereumChain' ? null : call(method, params), on() {}, removeListener() {} };
    window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { uuid: 'x', name: 'Demo Wallet', icon: '', rdns: 'demo.wallet' }, provider } })));
  }, { ACCT, RPC });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  return { ctx, p, errs };
};
const shot = async (p, name, { full = false, wait = 2500 } = {}) => { if (ONLY.length && !ONLY.some((o) => name.startsWith(o))) return; await p.waitForTimeout(wait); await p.screenshot({ path: OUT + name + '.png', fullPage: full }); console.log('saved', name); };
const connect = async (p) => { await p.locator('.top').getByRole('button', { name: /Connect wallet/ }).click(); await p.getByRole('button', { name: /Demo Wallet/ }).click(); await p.waitForSelector('.top .btn.ghost.sm'); };

// ---- desktop
let { ctx, p, errs } = await mk(1440, 900, true);
await p.goto(WEB + '/#/home'); await shot(p, '01-home-desktop', { wait: 4000 });
await p.goto(WEB + '/#/e/3'); if (!ONLY.length) { await p.waitForSelector('.opt'); await connect(p);
await p.locator('.opt').nth(0).click(); await p.getByRole('button', { name: /Burn 1/ }).click(); await p.waitForSelector('text=You voted', { timeout: 30000 }); } else { await p.waitForTimeout(1500); await connect(p); }
await shot(p, '02-live-room-desktop', { wait: 3500 });
await p.goto(WEB + '/#/create'); await p.getByPlaceholder(/Which Stock Token/).fill('Which city hosts the next World is Flat meetup?'); await p.getByPlaceholder('Option A').fill('Lagos'); await p.getByPlaceholder('Option B').fill('Nairobi'); await p.getByRole('button', { name: /Add option/ }).click(); await p.getByPlaceholder('Option C').fill('Accra'); await p.locator('input[type=number]').nth(1).fill('500').catch(() => {}); await shot(p, '03-create-election-desktop');
await p.goto(WEB + '/#/basket'); await shot(p, '04-peoples-basket-desktop', { wait: 4000 });
await p.goto(WEB + '/#/rails'); await p.waitForSelector('#gate-1'); await shot(p, '05-rails-petition-widget-desktop', { wait: 3500 });
await p.goto(WEB + '/widget-demo.html'); await shot(p, '05b-embed-widget-desktop', { wait: 3000 });
await p.goto(WEB + '/#/leaderboard'); await shot(p, '06-leaderboard-stats-desktop');
await p.goto(WEB + '/#/me'); await p.waitForSelector('text=Gasless first vote', { timeout: 15000 });
await p.waitForFunction(() => /0x[0-9a-fA-F]{40}/.test(document.querySelector('.card:last-of-type .addr, .addr:last-of-type')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
const smart = (await p.locator('.card:has-text("Gasless first vote") .addr').innerText()).trim();
if (smart.startsWith('0x')) { await giveWif(smart, 5n); }
await p.reload(); await p.waitForSelector('text=Gasless first vote'); await p.waitForSelector('text=WIF balance: 5', { timeout: 15000 }).catch(() => {}); await shot(p, '07-me-streak-gasless-desktop', { wait: 1500 });
console.log('desktop errors:', errs.join(' | ') || 'none'); await ctx.close();

// ---- mobile: home only here; live room + vote shots come from screens-mobile-vote.mts (creates a fresh open election)
({ ctx, p, errs } = await mk(390, 844, true));
await p.goto(WEB + '/#/home'); await shot(p, '08-home-mobile', { wait: 4000 });
console.log('mobile errors:', errs.join(' | ') || 'none'); await ctx.close(); await b.close();
