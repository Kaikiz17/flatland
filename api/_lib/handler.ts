/**
 * Flatland HTTP surface, written against the Web-standard Request/Response so the same code runs as
 *   • Vercel function   (api/[...path].ts)
 *   • Cloudflare Pages Function (functions/api/[[path]].ts)
 *   • local Node server (api/dev-server.ts)
 *
 * Routes:  GET /api/stats · /api/elections · /api/elections/:id · /api/og/:id(.png) · /api/share/:id · POST /api/mcp (MCP)
 */
import { createPublicClient, encodeFunctionData, http, parseUnits, type Address, type PublicClient } from 'viem';
import { flatlandAbi, erc20Abi } from '../../packages/core/src/abis.ts';
import { robinhood } from '../../packages/core/src/chain.ts';
import { readSnapshot, type Snapshot, type ElectionView } from '../../packages/core/src/snapshot.ts';
import { analyzeElection, type Analysis } from '../../packages/core/src/analysis.ts';
import { depositAddress } from '../../packages/core/src/deposit.ts';
import { voteLinks } from '../../packages/core/src/votelink.ts';
import type { Deployment } from '../../packages/core/src/deployment.ts';
import { ogSvg, svgToPng } from './og.ts';

export interface Env {
  INDEXER_URL?: string; // preferred: the always-on indexer (live + sybil groups)
  RPC_URL?: string; // fallback: read the chain directly
  APP_URL?: string; // public URL of the static site, for absolute links in cards/MCP
  DEPLOYMENT_URL?: string; // defaults to `${APP_URL}/deployment.json`
  FONT_FILES?: string; // comma list for the PNG rasteriser (Node only)
}

type Full = Snapshot & { analysis?: Record<number, Analysis> };
const cache = new Map<string, { at: number; v: Full }>();
const TTL = 10_000;

export async function loadSnapshot(env: Env, origin: string): Promise<Full> {
  const key = env.INDEXER_URL ?? env.RPC_URL ?? 'direct';
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  let v: Full;
  if (env.INDEXER_URL) {
    const r = await fetch(env.INDEXER_URL.replace(/\/$/, '') + '/snapshot.json');
    if (!r.ok) throw new Error('indexer ' + r.status);
    v = await r.json();
  } else {
    const depUrl = env.DEPLOYMENT_URL ?? `${(env.APP_URL ?? origin).replace(/\/$/, '')}/deployment.json`;
    const dep = (await (await fetch(depUrl)).json()) as Deployment;
    const client = createPublicClient({ chain: robinhood, transport: http(env.RPC_URL ?? robinhood.rpcUrls.default.http[0]) }) as PublicClient;
    v = await readSnapshot(client, dep);
  }
  cache.set(key, { at: Date.now(), v });
  return v;
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body, (_, x) => (typeof x === 'bigint' ? x.toString() : x)), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=5, s-maxage=10', ...extra },
  });

export function publicElection(s: Full, e: ElectionView, appUrl: string) {
  const a = s.analysis?.[e.id] ?? analyzeElection(e);
  const total = a.liveTallies.reduce((x, y) => x + y, 0);
  return {
    id: e.id, title: e.title, status: e.status, options: e.options.map((name, i) => ({ index: i, letter: String.fromCharCode(65 + i), name, votes: a.liveTallies[i], share: total ? a.liveTallies[i] / total : 0, depositAddress: e.depositAddresses[i] })),
    start: e.start, end: e.end, voteCostWei: e.voteCost, wifBurnedWei: e.burned, prizePoolWei: e.prizePool, winners: e.winners,
    winner: e.statusRaw === 2 ? e.winner : null, finalized: e.statusRaw === 2, executed: e.executed, creator: e.creator, tallier: e.tallier,
    voters: { raw: a.rawVoters, counted: a.counted, collapsed: a.collapsed, uniqueFundingSources: a.uniqueSources },
    fairness: a.fairness, url: `${appUrl}/#/e/${e.id}`, share: `${appUrl}/share/${e.id}`, ogImage: `${appUrl}/api/og/${e.id}.png`,
  };
}

const statsOf = (s: Full) => ({ ...s.totals, head: s.head, generatedAt: s.generatedAt, basket: s.basket ? { navUsdg: s.basket.navUsdg, feesBurned: s.basket.totalFeesBurned, wifBurnedByBuybacks: s.basket.buybackWifBurned, epoch: s.basket.round } : null });

// ───────────────────────────── MCP (stateless streamable-HTTP JSON-RPC) ─────────────────────────────
const TOOLS = [
  { name: 'list_elections', description: 'List Flatland elections with live tallies and fairness score. Optional status filter: open | ended | finalized.', inputSchema: { type: 'object', properties: { status: { type: 'string', enum: ['open', 'upcoming', 'ended', 'finalized'] }, limit: { type: 'number' } } } },
  { name: 'get_election', description: 'Get one election: options, live tallies, winner, fairness score, deposit addresses, links.', inputSchema: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } },
  { name: 'get_stats', description: 'Global stats: total $WIF burned, votes, elections, rails, basket.', inputSchema: { type: 'object', properties: {} } },
  { name: 'vote_link', description: 'Build the "just send 1 $WIF" vote link for an option: deposit address, EIP-681 URI and a web link. Never signs anything.', inputSchema: { type: 'object', properties: { id: { type: 'number' }, option: { type: 'number', description: 'zero-based index, or use letter' }, letter: { type: 'string' } }, required: ['id'] } },
  { name: 'prepare_vote', description: 'Unsigned transactions for a connect-wallet vote: approve $WIF then vote(). The caller signs with their own wallet.', inputSchema: { type: 'object', properties: { id: { type: 'number' }, option: { type: 'number' } }, required: ['id', 'option'] } },
  { name: 'prepare_create_election', description: 'Unsigned transactions that create an election (and optionally fund its prize). Returns calldata only; this server never holds keys.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, durationHours: { type: 'number' }, voteCostWif: { type: 'number' }, prizeWif: { type: 'number' }, winners: { type: 'number' }, trust: { type: 'string', enum: ['tallier', 'onchain'] } }, required: ['title', 'options', 'durationHours'] } },
] as const;

async function callTool(name: string, args: any, env: Env, origin: string) {
  const appUrl = (env.APP_URL ?? origin).replace(/\/$/, '');
  const s = await loadSnapshot(env, origin);
  const need = (id: number) => { const e = s.elections.find((x) => x.id === Number(id)); if (!e) throw new Error(`no election ${id}`); return e; };
  switch (name) {
    case 'list_elections': {
      let list = s.elections.slice().reverse();
      if (args?.status) list = list.filter((e) => e.status === args.status);
      return list.slice(0, Math.min(Number(args?.limit ?? 20), 50)).map((e) => publicElection(s, e, appUrl));
    }
    case 'get_election': return publicElection(s, need(args.id), appUrl);
    case 'get_stats': return statsOf(s);
    case 'vote_link': {
      const e = need(args.id);
      const option = args.letter ? String(args.letter).toUpperCase().charCodeAt(0) - 65 : Number(args.option);
      if (!Number.isInteger(option) || option < 0 || option >= e.options.length) throw new Error('bad option');
      const l = voteLinks({ appUrl, electionId: e.id, option, deposit: e.depositAddresses[option] });
      return { election: e.title, option: e.options[option], costWif: Number(BigInt(e.voteCost) / 10n ** 14n) / 1e4, note: 'Send from the wallet that should vote. One vote per wallet.', ...l };
    }
    case 'prepare_vote': {
      const e = need(args.id);
      if (!Number.isInteger(Number(args.option)) || args.option < 0 || args.option >= e.options.length) throw new Error('bad option');
      const dep = s.deployment;
      return { chainId: dep.chainId, steps: [
        { description: `approve ${e.voteCost} wei $WIF to Flatland`, to: dep.wif, value: '0x0', data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [dep.flatland, BigInt(e.voteCost)] }) },
        { description: `vote option ${args.option} (burns the $WIF)`, to: dep.flatland, value: '0x0', data: encodeFunctionData({ abi: flatlandAbi, functionName: 'vote', args: [BigInt(e.id), args.option] }) },
      ] };
    }
    case 'prepare_create_election': {
      const dep = s.deployment;
      const options: string[] = args.options;
      if (!Array.isArray(options) || options.length < 2 || options.length > 32) throw new Error('2-32 options required');
      const hours = Number(args.durationHours);
      if (!(hours >= 1 && hours <= 24 * 90)) throw new Error('durationHours must be 1..2160');
      const cost = parseUnits(String(args.voteCostWif ?? 1), 18);
      if (cost < 10n ** 18n) throw new Error('voteCostWif must be >= 1');
      const winners = Number(args.winners ?? 0);
      const prize = parseUnits(String(args.prizeWif ?? 0), 18);
      if (prize > 0n && winners < 1) throw new Error('prize needs winners >= 1');
      const end = BigInt(Math.floor(Date.now() / 1000) + Math.round(hours * 3600));
      const params = { title: String(args.title).slice(0, 140), options, metaURI: '', start: 0n, end, voteCost: cost, tallier: (args.trust === 'onchain' ? '0x0000000000000000000000000000000000000000' : dep.tallier) as Address, executor: '0x0000000000000000000000000000000000000000' as Address, challengeWindow: 12n * 3600n, winners, prizeToken: dep.wif, challengeBurn: 0n };
      const steps: any[] = [{ description: 'create the election', to: dep.flatland, value: '0x0', data: encodeFunctionData({ abi: flatlandAbi, functionName: 'createElection', args: [params] }) }];
      if (prize > 0n) {
        const nextId = BigInt(s.totals.elections + 1);
        steps.push({ description: 'approve prize $WIF', to: dep.wif, value: '0x0', data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [dep.flatland, prize] }) });
        steps.push({ description: `fund prize for election #${nextId} (assumes no other election is created first)`, to: dep.flatland, value: '0x0', data: encodeFunctionData({ abi: flatlandAbi, functionName: 'fundPrize', args: [nextId, prize] }) });
      }
      return { chainId: dep.chainId, note: 'Unsigned. Sign and send each step in order from the creator wallet.', steps };
    }
    default: throw new Error('unknown tool ' + name);
  }
}

async function mcp(req: Request, env: Env, origin: string): Promise<Response> {
  if (req.method === 'GET') return json({ name: 'flatland', protocol: 'MCP streamable HTTP (stateless JSON)', tools: TOOLS.map((t) => t.name) });
  let body: any;
  try { body = await req.json(); } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }, 400); }
  const one = async (m: any) => {
    const id = m.id ?? null;
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
    const bad = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
    try {
      switch (m.method) {
        case 'initialize': return ok({ protocolVersion: m.params?.protocolVersion ?? '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'flatland', version: '1.0.0' } });
        case 'notifications/initialized': return null;
        case 'ping': return ok({});
        case 'tools/list': return ok({ tools: TOOLS });
        case 'tools/call': {
          if (!TOOLS.some((t) => t.name === m.params?.name)) return bad(-32602, 'unknown tool');
          try {
            const out = await callTool(m.params.name, m.params.arguments ?? {}, env, origin);
            return ok({ content: [{ type: 'text', text: JSON.stringify(out, (_, x) => (typeof x === 'bigint' ? x.toString() : x), 2) }] });
          } catch (e) { return ok({ isError: true, content: [{ type: 'text', text: (e as Error).message }] }); }
        }
        default: return bad(-32601, 'method not found');
      }
    } catch (e) { return bad(-32603, (e as Error).message); }
  };
  if (Array.isArray(body)) { const r = (await Promise.all(body.map(one))).filter(Boolean); return r.length ? json(r) : new Response(null, { status: 202 }); }
  const r = await one(body);
  return r ? json(r, 200, { 'cache-control': 'no-store' }) : new Response(null, { status: 202 });
}

// ───────────────────────────── router ─────────────────────────────
export async function handle(req: Request, env: Env = {}): Promise<Response> {
  const url = new URL(req.url);
  const origin = url.origin;
  const appUrl = (env.APP_URL ?? origin).replace(/\/$/, '');
  const path = url.pathname.replace(/\/+$/, '');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' } });
  try {
    if (path.endsWith('/api/mcp')) return await mcp(req, env, origin);
    const s = await loadSnapshot(env, origin);
    if (path.endsWith('/api/stats')) return json(statsOf(s));
    if (path.endsWith('/api/elections')) {
      const st = url.searchParams.get('status');
      return json(s.elections.slice().reverse().filter((e) => !st || e.status === st).map((e) => publicElection(s, e, appUrl)));
    }
    let m = /\/api\/elections\/(\d+)$/.exec(path);
    if (m) { const e = s.elections.find((x) => x.id === Number(m![1])); return e ? json(publicElection(s, e, appUrl)) : json({ error: 'not found' }, 404); }
    m = /\/api\/og\/(\d+)(?:\.(png|svg))?$/.exec(path);
    if (m) {
      const e = s.elections.find((x) => x.id === Number(m![1]));
      if (!e) return json({ error: 'not found' }, 404);
      const p = publicElection(s, e, appUrl);
      const svg = ogSvg({ id: e.id, title: e.title, options: e.options, tallies: p.options.map((o) => o.votes), burnedWif: Number(BigInt(e.burned) / 10n ** 15n) / 1000, status: e.status, secondsLeft: e.end - Math.floor(Date.now() / 1000), voters: p.voters.counted, grade: p.fairness.grade, winner: p.winner ?? undefined });
      if (m[2] !== 'svg') {
        const png = await svgToPng(svg, (env.FONT_FILES ?? '').split(',').filter(Boolean));
        if (png) return new Response(png as unknown as BodyInit, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=30, s-maxage=60', 'access-control-allow-origin': '*' } });
      }
      return new Response(svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=30, s-maxage=60', 'access-control-allow-origin': '*' } });
    }
    m = /\/(?:api\/)?share\/(\d+)$/.exec(path);
    if (m) {
      const e = s.elections.find((x) => x.id === Number(m![1]));
      if (!e) return new Response('Not found', { status: 404 });
      const p = publicElection(s, e, appUrl);
      const total = p.options.reduce((a, o) => a + o.votes, 0);
      const lead = p.options.slice().sort((a, b) => b.votes - a.votes)[0];
      const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      const desc = total ? `${lead.name} leads with ${Math.round(lead.share * 100)}% · ${total} votes · ${Number(BigInt(e.burned) / 10n ** 18n).toLocaleString('en-US')} $WIF burned. 1 wallet = 1 vote.` : '1 wallet = 1 vote. Every vote burns $WIF. Be the first to vote.';
      const dest = `${appUrl}/#/e/${e.id}`;
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(e.title)} — Flatland</title>
<meta property="og:type" content="website"><meta property="og:title" content="${esc(e.title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${p.ogImage}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:url" content="${p.share}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(e.title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${p.ogImage}">
<meta http-equiv="refresh" content="0; url=${dest}"></head><body><a href="${dest}">Open the election →</a><script>location.replace(${JSON.stringify(dest)})</script></body></html>`;
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=30' } });
    }
    return json({ error: 'not found', routes: ['/api/stats', '/api/elections', '/api/elections/:id', '/api/og/:id.png', '/api/share/:id', 'POST /api/mcp'] }, 404);
  } catch (e) {
    return json({ error: (e as Error).message }, 502, { 'cache-control': 'no-store' });
  }
}
export { depositAddress };
