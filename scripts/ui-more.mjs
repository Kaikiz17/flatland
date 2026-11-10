// Read-only UI checks on the local demo: GOAT template, basket template + showcase, plain-wording pages, Flat Score, "I voted" card, mobile fit.
// usage: node scripts/ui-more.mjs <web> <voterAddress> <electionIdVoted> [shots]
import { chromium } from 'playwright-core';
const [WEB = 'http://127.0.0.1:5174', VOTER, EID = '4', shots] = process.argv.slice(2);
const OUT = new URL('../docs/screens/', import.meta.url).pathname;
const RPC = 'http://127.0.0.1:8545';
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const mk = async (w, h, mobile = false) => {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: shots ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(({ A, RPC }) => {
    const provider = { request: async ({ method, params }) => (method === 'eth_requestAccounts' || method === 'eth_accounts') ? [A] : method === 'wallet_switchEthereumChain' ? null : fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then((r) => r.json()).then((j) => j.result), on() {}, removeListener() {} };
    window.addEventListener('eip6963:requestProvider', () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { uuid: 't', name: 'Test Wallet', icon: '', rdns: 't.w' }, provider } })));
  }, { A: VOTER, RPC });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); return { p, errs };
};
const shot = async (p, n, full = false) => { if (shots) { await p.waitForTimeout(1200); await p.screenshot({ path: OUT + n, fullPage: full }); } };
const fit = async (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
let { p, errs } = await mk(1280, 900);

console.log('GOAT template + home slot');
await p.goto(WEB + '/#/create?template=goat');
await p.waitForSelector('input[placeholder="Option A"]');
ok(await p.locator('input[placeholder="Which Stock Token should the world buy first?"]').inputValue() === 'Who is the GOAT? — the rematch', 'title prefilled');
ok(await p.locator('input[placeholder^="Option "]').count() === 32, '32 candidates prefilled');
ok((await p.locator('input[placeholder="Option A"]').inputValue()) === 'Vlad Tenev', 'Vlad Tenev first');
ok(await p.locator('select').first().inputValue() === String(7 * 86400), '7-day duration preselected');
await shot(p, '20-goat-template-desktop.png');
await p.goto(WEB + '/#/');
await p.waitForSelector('.goatfeat');
ok((await p.locator('.goatfeat').innerText()).includes('Set up the GOAT rematch'), 'home slot shows the create CTA until an election exists');

console.log('basket template + showcase + plain wording');
await p.goto(WEB + '/#/create?template=basket');
await p.waitForSelector('text=The internet votes, the chain buys');
ok(await p.locator('.steps li').count() === 3, 'basket template has the 3-step strip');
ok((await p.locator('body').innerText()).includes('SPY') && (await p.locator('body').innerText()).includes('TSLA'), 'ballot lists the real Stock Tokens');
await p.goto(WEB + '/#/basket');
await p.waitForSelector('.showcase');
const bt = await p.locator('main').innerText();
ok(/Put in dollars\. \$WIF holders vote which stock it buys\. Withdraw your share anytime\./.test(bt), 'basket one-liner');
ok(await p.locator('.steps li').count() === 3, 'basket 3-step strip');
ok(bt.includes('The internet votes. The chain buys.') && /lock in the result/i.test(bt), 'showcase stages');
await shot(p, '21-stock-pot-showcase-desktop.png', true);
await p.goto(WEB + '/#/rails');
await p.waitForSelector('.steps');
const rt = await p.locator('main').innerText();
ok(rt.includes('Send 1 $WIF to an address from any wallet to vote, RSVP, sign or join. No website, no sign-up'), 'rails one-liner');
ok(await p.locator('.steps li').count() === 3, 'rails 3-step strip');
ok((await p.locator('nav.nav').innerText()).includes('People’s Basket') && (await p.locator('nav.nav').innerText()).includes('Rails'), 'nav renamed');

console.log('Flat Score');
await p.goto(WEB + `/#/score/${VOTER}`);
await p.waitForSelector('text=Flat Score');
const st = await p.locator('main').innerText();
ok(/Share on X/.test(st) && /Votes & acts/i.test(st), 'score card renders with Share on X');
ok((await p.locator('a:has-text("Share on X")').getAttribute('href')).includes(encodeURIComponent('/share/score/' + VOTER)), 'X link points at /share/score/<addr>');
const j = await (await fetch(`${WEB}/api/score/${VOTER}`)).json();
ok(j.score > 0 && j.votes >= 1, 'API score ' + j.score + ' rank ' + j.rank + '/' + j.of);
const sh = await (await fetch(`${WEB}/share/score/${VOTER}`)).text();
ok(sh.includes('Flat Score') && sh.includes('og:image'), '/share/score OG page');
const sv = await (await fetch(`${WEB}/api/og/score/${VOTER}.svg`)).text();
ok(sv.startsWith('<svg') && sv.includes('FLAT SCORE'), 'score SVG card');
await shot(p, '22-flat-score-desktop.png');
await p.goto(WEB + '/#/leaderboard');
await p.waitForSelector('table.t a[href^="#/score/"]');
ok(true, 'leaderboard links to score pages');

console.log('I voted card');
await p.goto(WEB + `/#/e/${EID}`);
await p.locator('.top').getByRole('button', { name: /Connect wallet/ }).click();
await p.getByRole('button', { name: /Test Wallet/ }).click();
await p.waitForSelector('[data-testid=voted-card] img', { timeout: 20000 });
await p.waitForFunction(() => { const i = document.querySelector('[data-testid=voted-card] img'); return i && i.complete && i.naturalWidth > 0; });
ok(true, '"I voted" image card renders for a wallet that voted');
ok(decodeURIComponent(await p.locator('[data-testid=voted-card] a').first().getAttribute('href')).includes('/share/voted/'), 'share link -> /share/voted/<id>/<opt>');
const vo = await (await fetch(`${WEB}/share/voted/${EID}/0`)).text();
ok(vo.includes('og:image') && vo.includes('I voted'), '/share/voted OG page');
await shot(p, '23-i-voted-card-desktop.png');
ok(errs.length === 0, 'no page errors ' + errs.join('|'));

console.log('mobile');
const m = await mk(390, 844, true);
for (const r of ['', 'basket', 'rails', `score/${VOTER}`, 'create?template=goat', 'create?template=basket', `e/${EID}`]) {
  await m.p.goto(`${WEB}/#/${r}`); await m.p.waitForTimeout(1200);
  const o = await fit(m.p); ok(o <= 1, `#/${r || 'home'} fits a 390px phone (delta ${o})`);
  if (r === 'basket') await shot(m.p, '24-stock-pot-mobile.png');
}
await b.close();
console.log(fails ? `\n❌ ${fails} failed` : '\n✅ MORE UI PASSED'); process.exit(fails ? 1 : 0);
