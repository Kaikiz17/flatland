import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeFunctionData } from 'viem';
import { handle } from '../_lib/handler.ts';
import { ogSvg, wrap } from '../_lib/og.ts';
import { flatlandAbi } from '../../packages/core/src/abis.ts';

const A = (n: number) => ('0x' + n.toString(16).padStart(40, '0')) as `0x${string}`;
const dep = { chainId: 4663, deployBlock: 1, wif: A(1), usdg: A(2), tallier: A(3), entropy: A(4), standing: A(5), flatland: A(6), boxImpl: A(7), gate: A(8), participation: A(9), buyback: A(10), basket: A(11), accountFactory: A(12), paymaster: A(13) };
const now = Math.floor(Date.now() / 1000);
const election = {
  id: 1, creator: A(50), title: 'Which Stock Token should the world buy first?', options: ['NVDA', 'SPY', 'TSLA'], metaURI: '', start: now - 100, end: now + 3600, voteCost: (10n ** 18n).toString(),
  tallier: A(3), executor: A(0), winners: 0, prizeToken: A(1), status: 'open', statusRaw: 1, winner: 0, executed: false, tallies: [2, 1, 0], chainTally: [2, 1, 0], depositTally: [0, 0, 0],
  depositsSubmitted: false, depositRoot: '0x', depositCount: 0, challengeEnds: 0, openChallenges: 0, burned: (3n * 10n ** 18n).toString(), prizePool: '0', drawBlock: 0, seed: '0x',
  chainVotes: [1, 2, 3].map((n, i) => ({ voter: A(100 + n), option: i === 2 ? 1 : 0, block: n, logIndex: 0, ts: now - 50, tx: ('0x' + String(n).padStart(64, '0')) as `0x${string}` })), depositVotes: [], depositAddresses: [A(200), A(201), A(202)], collapsed: [], challenges: [],
};
const snap = { version: 1, generatedAt: now, head: 10, deployment: dep, totals: { wifBurned: (3n * 10n ** 18n).toString(), electionBurned: '0', gateBurned: '0', buybackBurned: '0', votes: 3, elections: 1, gates: 0, participants: 3, acts: 0 }, elections: [election], gates: [], basket: null, countries: {}, voterCountry: {}, standing: {} };
const env = { INDEXER_URL: 'http://indexer.test', APP_URL: 'https://flat.example' };
const get = (p: string) => handle(new Request('https://flat.example' + p), env);
const rpc = (body: unknown) => handle(new Request('https://flat.example/api/mcp', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), env);
const call = async (name: string, args: unknown) => JSON.parse(((await (await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).json()) as any).result.content[0].text);

beforeEach(() => { vi.stubGlobal('fetch', async () => new Response(JSON.stringify(snap))); });
afterEach(() => vi.unstubAllGlobals());

describe('JSON API', () => {
  it('stats', async () => { const j: any = await (await get('/api/stats')).json(); expect(j.votes).toBe(3); });
  it('lists elections with live tallies + fairness', async () => {
    const j: any = await (await get('/api/elections?status=open')).json();
    expect(j).toHaveLength(1);
    expect(j[0].options[0]).toMatchObject({ name: 'NVDA', votes: 2 });
    expect(j[0].fairness.grade).toBeTypeOf('string');
    expect(j[0].share).toBe('https://flat.example/share/1');
  });
  it('404s unknown election', async () => { expect((await get('/api/elections/9')).status).toBe(404); });
  it('share page carries OG + twitter card meta and redirects', async () => {
    const h = await (await get('/share/1')).text();
    expect(h).toContain('og:image" content="https://flat.example/api/og/1.png"');
    expect(h).toContain('summary_large_image');
    expect(h).toContain('#/e/1');
  });
});

describe('OG card', () => {
  it('builds valid-looking SVG and escapes user text', () => {
    const svg = ogSvg({ id: 1, title: '<script>alert(1)</script> & more', options: ['A&B', 'C'], tallies: [3, 1], burnedWif: 1234, status: 'open', secondsLeft: 7200, voters: 4, grade: 'A' });
    expect(svg).toContain('width="1200"');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('1,234');
  });
  it('wraps and truncates long titles', () => { expect(wrap('word '.repeat(60), 30, 3)).toHaveLength(3); });
  it('serves svg on demand and PNG when a rasteriser exists', async () => {
    const svg = await get('/api/og/1.svg');
    expect(svg.headers.get('content-type')).toBe('image/svg+xml');
    const r = await handle(new Request('https://flat.example/api/og/1.png'), { ...env, FONT_FILES: new URL('../assets/LiberationSans-Bold.ttf', import.meta.url).pathname });
    const ct = r.headers.get('content-type');
    if (ct === 'image/png') {
      const b = new Uint8Array(await r.arrayBuffer());
      expect([...b.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      expect(b.length).toBeGreaterThan(5000);
    } else expect(ct).toBe('image/svg+xml'); // graceful fallback
  });
});

describe('MCP', () => {
  it('initialize + tools/list', async () => {
    const init: any = await (await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).json();
    expect(init.result.serverInfo.name).toBe('flatland');
    const tl: any = await (await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
    expect(tl.result.tools.map((t: any) => t.name)).toEqual(expect.arrayContaining(['list_elections', 'get_election', 'vote_link', 'prepare_create_election']));
  });
  it('notifications get 202 and no body', async () => { expect((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202); });
  it('get_election / vote_link', async () => {
    expect((await call('get_election', { id: 1 })).title).toContain('Stock Token');
    const l = await call('vote_link', { id: 1, letter: 'B' });
    expect(l.depositAddress.toLowerCase()).toBe(A(201));
    expect(l.eip681).toContain('uint256=1000000000000000000');
  });
  it('prepare_create_election returns decodable UNSIGNED calldata and never signs', async () => {
    const out = await call('prepare_create_election', { title: 'Lunch?', options: ['Pizza', 'Jollof'], durationHours: 24, prizeWif: 10, winners: 2 });
    expect(out.steps).toHaveLength(3);
    const d: any = decodeFunctionData({ abi: flatlandAbi, data: out.steps[0].data });
    expect(d.functionName).toBe('createElection');
    expect(d.args[0].options).toEqual(['Pizza', 'Jollof']);
    expect(d.args[0].tallier.toLowerCase()).toBe(A(3));
    expect(JSON.stringify(out)).not.toMatch(/privateKey|signature/i);
  });
  it('rejects bad input as a tool error, not a crash', async () => {
    const r: any = await (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'prepare_create_election', arguments: { title: 'x', options: ['only one'], durationHours: 1 } } })).json();
    expect(r.result.isError).toBe(true);
  });
});
