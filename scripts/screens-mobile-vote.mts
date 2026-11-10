// Creates a fresh election through the real UI (demo wallet), adds a few votes from dev accounts, then captures mobile vote shots.
import { chromium } from 'playwright-core';
import { createPublicClient, createWalletClient, http, keccak256, encodeAbiParameters, maxUint256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'node:fs';
import { flatlandAbi, erc20Abi, localChain } from '@flatland/core';
const WEB = 'http://127.0.0.1:5173', RPC = 'http://127.0.0.1:8545';
const OUT = new URL('../docs/screens/', import.meta.url).pathname;
const dep = JSON.parse(readFileSync(new URL('../deployments/local.json', import.meta.url), 'utf8'));
const chain = localChain(RPC); const pub = createPublicClient({ chain, transport: http(RPC) });
const rpc = (method, params) => fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json());
const ACCT = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc';
const giveWif = (a, n) => rpc('anvil_setStorageAt', [dep.wif, keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [a, 0n])), '0x' + (n * 10n ** 18n).toString(16).padStart(64, '0')]);
await rpc('anvil_setBalance', [ACCT, '0x56bc75e2d63100000']); await giveWif(ACCT, 10n);
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.addInitScript(`(() => { const ACCT = ${JSON.stringify(ACCT)}, RPC = ${JSON.stringify(RPC)};
  const call = (method, params) => fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: (window.__id = (window.__id || 0) + 1), method, params }) }).then((r) => r.json()).then((j) => { if (j.error) throw new Error(j.error.message); return j.result; });
  const provider = { request: async ({ method, params }) => (method === 'eth_requestAccounts' || method === 'eth_accounts') ? [ACCT] : method === 'wallet_switchEthereumChain' ? null : call(method, params), on() {}, removeListener() {} };
  window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { uuid: 'x', name: 'Demo Wallet', icon: '', rdns: 'demo.wallet' }, provider } })));
})()`);
const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(WEB + '/#/create'); await p.waitForTimeout(4000);
await p.locator('.top').getByRole('button', { name: /Connect wallet/ }).click(); await p.waitForTimeout(800); await p.screenshot({ path: '/tmp/m-modal.png' }); await p.getByRole('button', { name: /Demo Wallet/ }).click(); await p.waitForSelector('.top .btn.ghost.sm');
await p.getByPlaceholder(/Which Stock Token/).fill('Which city hosts the next World is Flat meetup?');
await p.getByPlaceholder('Option A').fill('Lagos'); await p.getByPlaceholder('Option B').fill('Nairobi');
await p.getByRole('button', { name: /Add option/ }).click(); await p.getByPlaceholder('Option C').fill('Accra');
await p.locator('form button[type=submit], .card button.btn').filter({ hasText: /Create|Launch|Start/ }).last().click();
await p.waitForFunction(() => /#\/e\/\d+/.test(location.hash), null, { timeout: 40000 }).catch(async () => { await p.screenshot({ path: '/tmp/m-create.png' }); throw new Error('no redirect'); });
const id = Number(p.url().match(/#\/e\/(\d+)/)[1]); console.log('created election', id);
for (const [i, opt] of [0, 0, 1, 2, 0].entries()) {
  const k = ['0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e', '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356', '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97', '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6', '0xf214f2b2cd398c806f84e317059661321d4fa3e1e80f1c4b5d6b8b1fd84fe0a8'][i];
  const a = privateKeyToAccount(k); await rpc('anvil_setBalance', [a.address, '0x56bc75e2d63100000']); await giveWif(a.address, 5n);
  const w = createWalletClient({ chain, transport: http(RPC), account: a });
  for (const [address, abi, fn, args] of [[dep.wif, erc20Abi, 'approve', [dep.flatland, maxUint256]], [dep.flatland, flatlandAbi, 'vote', [BigInt(id), opt]]]) {
    const h = await w.writeContract({ address, abi, functionName: fn, args, chain, account: a }); await pub.waitForTransactionReceipt({ hash: h });
  }
}
await p.waitForTimeout(500);
await p.goto(WEB + '/#/e/' + id); await p.waitForTimeout(4500);
await p.screenshot({ path: OUT + '09-live-room-mobile.png' });
await p.evaluate(() => window.scrollTo(0, 560)); await p.waitForTimeout(600);
await p.screenshot({ path: OUT + '09b-live-room-feed-mobile.png' });
await p.goto(WEB + '/#/e/' + id + '?vote=1'); await p.waitForTimeout(3500);
await p.evaluate(() => { const el = document.querySelector('.opt[aria-pressed="true"]'); if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 330); }); await p.waitForTimeout(600);
await p.screenshot({ path: OUT + '10-vote-mobile.png' });
console.log('errors:', errs.join('|') || 'none'); await b.close();
