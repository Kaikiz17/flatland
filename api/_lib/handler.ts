/**
 * Flatland HTTP surface, written against the Web-standard Request/Response so the same code runs as
 *   • Vercel function   (api/[...path].ts)
 *   • Cloudflare Pages Function (functions/api/[[path]].ts)
 *   • local Node server (api/dev-server.ts)
 *
 * Routes:  GET /api/stats · /api/elections · /api/elections/:id · /api/og/:id(.png) · /api/share/:id · POST /api/mcp (MCP)
 */
import { createPublicClient, encodeFunctionData, http, parseUnits, verifyMessage, type Address, type PublicClient } from 'viem';
import { flatlandAbi, erc20Abi } from '../../packages/core/src/abis.ts';
import { robinhood } from '../../packages/core/src/chain.ts';
import { readSnapshot, type Snapshot, type ElectionView } from '../../packages/core/src/snapshot.ts';
import { analyzeElection, type Analysis } from '../../packages/core/src/analysis.ts';
import { depositAddress } from '../../packages/core/src/deposit.ts';
import { voteLinks } from '../../packages/core/src/votelink.ts';
import type { Deployment } from '../../packages/core/src/deployment.ts';
import { ogSvg, cardSvg, votedSvg, votedPoster, signedSvg, signedPoster, signedHeadline, svgToPng, privatePoster, privateSvg, stocksPoster, stocksSvg } from './og.ts';
import { checkChallenge, issueChallenge, makePassId, PASS_RE } from './pass.ts';
import type { PassRole } from './poster.ts';
import { flatScore } from '../../packages/core/src/score.ts';
import { loadMedia, type KVLike, type Media } from './media.ts';
import { telegramCalls } from './telegram.ts';

export interface Env {
  INDEXER_URL?: string; // preferred: the always-on indexer (live + sybil groups)
  RPC_URL?: string; // fallback: read the chain directly
  APP_URL?: string; // public URL of the static site, for absolute links in cards/MCP
  DEPLOYMENT_URL?: string; // defaults to `${APP_URL}/deployment.json`
  FONT_FILES?: string; // comma list for the PNG rasteriser (Node only)
  /** Edge workers: a pre-computed snapshot (e.g. from KV, written by the cron tallier). Return null to fall back to RPC. */
  getSnapshot?: () => Promise<any | null>;
  /** Edge workers: bundled deployment record, so the RPC fallback needs no extra fetch. */
  deployment?: Deployment;
  /** Edge workers cannot rasterise PNG within the free CPU budget: point twitter:image at the static /og-default.png (og:image stays the live SVG card). */
  staticTwitterImage?: boolean;
  /** Edge workers: KV for option images + election metadata blobs (see media.ts). */
  kv?: KVLike;
  /** Worker secrets (never logged). Telegram stays disabled until TELEGRAM_BOT_TOKEN is set. */
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  /** Worker secret (never logged). HMAC key for verifiable private pass IDs. */
  PASS_SECRET?: string;
}

type Full = Snapshot & { analysis?: Record<number, Analysis> };
const cache = new Map<string, { at: number; v: Full }>();
const TTL = 10_000;

export async function loadSnapshot(env: Env, origin: string): Promise<Full> {
  const key = env.INDEXER_URL ?? env.RPC_URL ?? 'direct';
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  let v: Full | undefined;
  const pre = env.getSnapshot ? await env.getSnapshot() : null;
  if (pre) v = pre;
  else if (env.INDEXER_URL) {
    const r = await fetch(env.INDEXER_URL.replace(/\/$/, '') + '/snapshot.json');
    if (!r.ok) throw new Error('indexer ' + r.status);
    v = await r.json();
  } else {
    const depUrl = env.DEPLOYMENT_URL ?? `${(env.APP_URL ?? origin).replace(/\/$/, '')}/deployment.json`;
    const dep = env.deployment ?? ((await (await fetch(depUrl)).json()) as Deployment);
    const client = createPublicClient({ chain: robinhood, transport: http(env.RPC_URL ?? robinhood.rpcUrls.default.http[0], { batch: true }) }) as PublicClient;
    v = await readSnapshot(client, dep);
  }
  cache.set(key, { at: Date.now(), v: v! });
  return v!;
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body, (_, x) => (typeof x === 'bigint' ? x.toString() : x)), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=5, s-maxage=10', ...extra },
  });

export function publicElection(s: Full, e: ElectionView, appUrl: string, media?: Media | null) {
  const a = s.analysis?.[e.id] ?? analyzeElection(e);
  const total = a.liveTallies.reduce((x, y) => x + y, 0);
  return {
    id: e.id, title: e.title, status: e.status, options: e.options.map((name, i) => ({ index: i, letter: String.fromCharCode(65 + i), name, votes: a.liveTallies[i], share: total ? a.liveTallies[i] / total : 0, depositAddress: e.depositAddresses[i], image: media?.images?.[i] ? `${appUrl}/img/${media.images[i]}` : null, voteUrl: `${appUrl}/v/${e.id}/${i}` })),
    details: media?.details ?? null,
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
      return Promise.all(list.slice(0, Math.min(Number(args?.limit ?? 20), 50)).map(async (e) => publicElection(s, e, appUrl, await loadMedia(env.kv, e.metaURI))));
    }
    case 'get_election': { const e = need(args.id); return publicElection(s, e, appUrl, await loadMedia(env.kv, e.metaURI)); }
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

// ───────────────────────────── Telegram webhook ─────────────────────────────
async function telegram(req: Request, env: Env, origin: string, appUrl: string): Promise<Response> {
  if (req.method === 'GET') return json({ bot: 'flatland', configured: !!env.TELEGRAM_BOT_TOKEN, webhook: `${appUrl}/api/telegram`, commands: ['/start', '/elections', '/vote <id> <option>', '/results <id>', 'inline: @bot [id]'] }, 200, { 'cache-control': 'no-store' });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!env.TELEGRAM_BOT_TOKEN) return json({ ok: false, error: 'Telegram bot is not configured (TELEGRAM_BOT_TOKEN secret not set)' }, 503, { 'cache-control': 'no-store' });
  if (env.TELEGRAM_WEBHOOK_SECRET && req.headers.get('x-telegram-bot-api-secret-token') !== env.TELEGRAM_WEBHOOK_SECRET) return json({ error: 'forbidden' }, 403);
  let update: any;
  try { update = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  const s = await loadSnapshot(env, origin);
  const elections = await Promise.all(s.elections.map(async (e) => {
    const p = publicElection(s, e, appUrl, await loadMedia(env.kv, e.metaURI));
    return { id: e.id, title: e.title, status: e.status, voteCostWei: e.voteCost, url: p.url, share: p.share, end: e.end, burnedWif: Number(BigInt(e.burned) / 10n ** 16n) / 100, options: p.options.map((o) => ({ index: o.index, letter: o.letter, name: o.name, votes: o.votes, share: o.share, depositAddress: o.depositAddress, voteUrl: o.voteUrl })) };
  }));
  const calls = await telegramCalls(update, elections, appUrl);
  for (const c of calls) {
    // the token only ever goes in the URL of this one HTTPS call to Telegram; it is never logged or returned
    const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${c.method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c.body) });
    if (!r.ok) return json({ ok: false, error: `telegram ${c.method} failed (${r.status})` }, 200, { 'cache-control': 'no-store' }); // 200: never make Telegram retry-storm us
  }
  return json({ ok: true, calls: calls.map((c) => c.method) }, 200, { 'cache-control': 'no-store' });
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
    if (path.endsWith('/api/telegram')) return await telegram(req, env, origin, appUrl);
    const s = await loadSnapshot(env, origin);
    if (path.endsWith('/api/stats')) return json(statsOf(s));
    if (path.endsWith('/api/elections')) {
      const st = url.searchParams.get('status');
      const list = s.elections.slice().reverse().filter((e) => !st || e.status === st);
      return json(await Promise.all(list.map(async (e, i) => publicElection(s, e, appUrl, i < 24 ? await loadMedia(env.kv, e.metaURI) : null))));
    }
    let m = /\/api\/elections\/(\d+)$/.exec(path);
    if (m) { const e = s.elections.find((x) => x.id === Number(m![1])); return e ? json(publicElection(s, e, appUrl, await loadMedia(env.kv, e.metaURI))) : json({ error: 'not found' }, 404); }
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
    // ── Flat Score + "I voted" cards ──
    const svgRes = (svg: string) => new Response(svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=30, s-maxage=60', 'access-control-allow-origin': '*' } });
    const shortA = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
    const scoreCard = (addr: string) => {
      const f = flatScore(s, addr);
      return { f, svg: cardSvg({ kicker: 'Flat Score', title: shortA(addr), big: String(f.score), bigLabel: f.rank ? `rank #${f.rank} of ${f.of}` : 'not ranked yet', lines: [`Tier: ${f.tierName}  ·  ${f.streak}-week streak`, `${f.votes + f.acts} votes & acts  ·  ${f.created} elections created`, `${Number(BigInt(f.burned) / 10n ** 16n) / 100} $WIF burned`], foot: 'Flat Score: public, on-chain, recomputable · open to everyone' }) };
    };
    const cardMeta = (sp: URLSearchParams) => {
      const rawW = sp.get('w') ?? sp.get('wallet') ?? '';
      const wallet = /^0x[0-9a-fA-F]{40}$/.test(rawW) ? rawW : undefined;
      const rawT = sp.get('t') ?? sp.get('date') ?? sp.get('d') ?? '';
      let ts: number | undefined;
      if (/^\d{10,13}$/.test(rawT)) { ts = Number(rawT); if (ts > 1e12) ts = Math.floor(ts / 1000); }
      return { wallet, ts };
    };
    const embedImg = async (hash: string): Promise<string | undefined> => {
      if (!env.kv) return;
      try {
        const b: ArrayBuffer | null = await env.kv.get(`img:${hash}`, { type: 'arrayBuffer', cacheTtl: 3600 });
        if (!b) return;
        const u = new Uint8Array(b);
        const mime = u[0] === 0xff ? 'image/jpeg' : 'image/webp';
        let s = '';
        for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
        return `data:${mime};base64,${btoa(s)}`;
      } catch { return; }
    };
    const votedCard = async (id: number, opt: number, voterNo?: number) => {
      const e = s.elections.find((x) => x.id === id);
      if (!e || opt < 0 || opt >= e.options.length) return null;
      const media = await loadMedia(env.kv, e.metaURI);
      const p = publicElection(s, e, appUrl, media);
      const burn = Number(BigInt(e.voteCost) / 10n ** 16n) / 100;
      const q = cardMeta(url.searchParams);
      const votes = [...e.chainVotes, ...e.depositVotes];
      const ev = (q.wallet ? votes.find((v) => v.voter.toLowerCase() === q.wallet!.toLowerCase()) : undefined)
        ?? (voterNo && voterNo > 0 && voterNo <= votes.length ? votes[voterNo - 1] : undefined);
      const hash = media?.images?.[String(opt)] ?? media?.images?.[opt];
      const image = (hash ? await embedImg(hash) : undefined) ?? (hash ? `${appUrl}/img/${hash}` : undefined);
      const rawX = url.searchParams.get('x') ?? '';
      const seed = /^0x[0-9a-fA-F]{16,}$/.test(rawX) ? rawX : ev?.tx;
      const input = { title: e.title, letter: p.options[opt].letter, option: p.options[opt].name, burnedWif: burn, votes: p.options.reduce((a, o) => a + o.votes, 0), voterNo, wallet: q.wallet ?? ev?.voter, ts: q.ts ?? ev?.ts, image, seed };
      return { e, p, svg: votedSvg(input), poster: votedPoster(input) };
    };
    const signedCard = (id: number, position?: number) => {
      const g = (s.gates ?? []).find((x) => x.id === id);
      if (!g) return null;
      const burn = Number(BigInt(g.cost) / 10n ** 16n) / 100;
      const headline = signedHeadline(g.kind, g.title);
      const pos = position && position > 0 ? position : (g.count || undefined);
      const q = cardMeta(url.searchParams);
      const actor = (q.wallet ? g.actors.find((a) => a.who.toLowerCase() === q.wallet!.toLowerCase()) : undefined)
        ?? (pos ? g.actors.find((a) => a.position + 1 === pos) : undefined);
      const rawX = url.searchParams.get('x') ?? '';
      const seed = /^0x[0-9a-fA-F]{16,}$/.test(rawX) ? rawX : actor?.tx;
      const input = { kind: g.kind, title: g.title, burnedWif: burn, position: pos, headline, wallet: q.wallet ?? actor?.who, ts: q.ts ?? actor?.ts, seed };
      return { g, headline, svg: signedSvg(input), poster: signedPoster(input) };
    };
    let sm = /\/api\/score\/(0x[0-9a-fA-F]{40})$/.exec(path);
    if (sm) return json(flatScore(s, sm[1]));
    sm = /\/api\/og\/score\/(0x[0-9a-fA-F]{40})(?:\.svg)?$/.exec(path);
    if (sm) return svgRes(scoreCard(sm[1]).svg);
    sm = /\/api\/og\/voted\/(\d+)\/(\d+)(?:\/(\d+))?(?:\.svg)?$/.exec(path);
    if (sm) { const c = await votedCard(Number(sm[1]), Number(sm[2]), sm[3] ? Number(sm[3]) : undefined); return c ? svgRes(c.svg) : json({ error: 'not found' }, 404); }
    sm = /\/api\/og\/signed\/(\d+)(?:\/(\d+))?(?:\.svg)?$/.exec(path);
    if (sm) { const c = signedCard(Number(sm[1]), sm[2] ? Number(sm[2]) : undefined); return c ? svgRes(c.svg) : json({ error: 'not found' }, 404); }
    sm = /\/api\/card\/voted\/(\d+)\/(\d+)(?:\/(\d+))?(?:\.svg)?$/.exec(path);
    if (sm) { const c = await votedCard(Number(sm[1]), Number(sm[2]), sm[3] ? Number(sm[3]) : undefined); return c ? svgRes(c.poster) : json({ error: 'not found' }, 404); }
    sm = /\/api\/card\/signed\/(\d+)(?:\/(\d+))?(?:\.svg)?$/.exec(path);
    if (sm) { const c = signedCard(Number(sm[1]), sm[2] ? Number(sm[2]) : undefined); return c ? svgRes(c.poster) : json({ error: 'not found' }, 404); }

    // ── Pass IDs, private cards, Stocks cards (compute on demand; no per-signer KV writes) ──
    const secret = env.PASS_SECRET;
    const noSecret = () => json({ error: 'pass not configured' }, 503, { 'cache-control': 'no-store' });
    const unauth = () => json({ error: 'unauthorized' }, 401, { 'cache-control': 'no-store' });
    const collectHits = () => {
      const dep = s.deployment;
      const hits: { kind: 'sign'; scope: string; contract: string; id: string; wallet: string; tx: string; ts?: number; block?: number; title: string; detail?: string; creator?: string; position?: number; signKind?: number }[] = [];
      for (const g of s.gates ?? []) {
        for (const a of g.actors) {
          if (!a.tx) continue;
          hits.push({ kind: 'sign', scope: `gate:${g.id}`, contract: dep.gate, id: String(g.id), wallet: a.who, tx: a.tx, ts: a.ts, block: a.block, title: g.title, detail: `#${a.position + 1}`, creator: g.creator, position: a.position + 1, signKind: g.kind });
        }
      }
      return hits;
    };
    const prove = async (message?: string, signature?: string) => {
      if (!secret) return { err: noSecret() as Response };
      const msg = message ?? url.searchParams.get('message') ?? '';
      const sig = (signature ?? url.searchParams.get('signature') ?? '') as `0x${string}`;
      const ch = await checkChallenge(secret, msg);
      if (!ch || !/^0x[0-9a-fA-F]{130,}$/.test(sig)) return { err: unauth() as Response };
      try {
        const ok = await verifyMessage({ address: ch.address as Address, message: msg, signature: sig });
        if (!ok) return { err: unauth() as Response };
      } catch { return { err: unauth() as Response }; }
      return { ch };
    };
    const withIds = async (hits: ReturnType<typeof collectHits>) => {
      if (!secret) return [];
      const chainId = s.deployment.chainId;
      const out = [];
      for (const h of hits) out.push({ ...h, passId: await makePassId(secret, chainId, h.contract, h.scope, h.wallet, h.tx) });
      return out;
    };

    if (path === '/api/pass/challenge') {
      if (!secret) return noSecret();
      const address = url.searchParams.get('address') ?? '';
      const purpose = url.searchParams.get('purpose') ?? 'private-pass';
      if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !/^[a-z0-9:.-]{3,80}$/.test(purpose)) return json({ error: 'bad request' }, 400);
      const { message, issued } = await issueChallenge(secret, address, purpose);
      return json({ message, issued }, 200, { 'cache-control': 'no-store' });
    }
    if (path === '/api/pass/verify' && req.method === 'GET' && !url.searchParams.get('signature')) {
      if (!secret) return noSecret();
      const id = (url.searchParams.get('id') ?? '').toUpperCase();
      if (!PASS_RE.test(id)) return json({ valid: false });
      const found = (await withIds(collectHits())).find((h) => h.passId === id);
      if (!found) return json({ valid: false });
      return json({ valid: true, kind: found.kind, id: found.id, scope: found.scope });
    }
    if (path === '/api/pass/verify' && (req.method === 'POST' || url.searchParams.get('signature'))) {
      if (!secret) return noSecret();
      let body: any = {};
      if (req.method === 'POST') { try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); } }
      const id = String(body.id ?? url.searchParams.get('id') ?? '').toUpperCase();
      const auth = await prove(body.message, body.signature);
      if ('err' in auth && auth.err) return auth.err;
      const ch = 'ch' in auth ? auth.ch : undefined;
      if (!ch || !PASS_RE.test(id)) return json({ valid: false });
      const found = (await withIds(collectHits())).find((h) => h.passId === id);
      if (!found) return json({ valid: false });
      const isCreator = found.creator && found.creator.toLowerCase() === ch.address.toLowerCase();
      const purposeOk = ch.purpose === `creator:gate:${found.id}`;
      if (!isCreator || !purposeOk) return json({ valid: true, kind: found.kind, id: found.id, scope: found.scope }); // not the creator: no wallet
      return json({ valid: true, kind: found.kind, id: found.id, scope: found.scope, wallet: found.wallet, ts: found.ts, tx: found.tx });
    }
    if (path === '/api/pass/list') {
      if (!secret) return noSecret();
      let body: any = {};
      if (req.method === 'POST') { try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); } }
      const auth = await prove(body.message, body.signature);
      if ('err' in auth && auth.err) return auth.err;
      const ch = 'ch' in auth ? auth.ch! : undefined as any;
      const kind = String(body.kind ?? url.searchParams.get('kind') ?? '');
      const id = String(body.id ?? url.searchParams.get('id') ?? '');
      if (!ch || kind !== 'gate' || !id) return json({ error: 'bad request' }, 400);
      if (ch.purpose !== `creator:gate:${id}`) return unauth();
      const g = s.gates?.find((x) => String(x.id) === id);
      if (!g || g.creator.toLowerCase() !== ch.address.toLowerCase()) return unauth();
      const hits = collectHits().filter((h) => h.id === id);
      const rows = await withIds(hits);
      let names: Record<string, string> = {};
      try {
        const raw = env.kv ? await env.kv.get(`passnames:${id}`) : null;
        if (typeof raw === 'string' && raw) names = JSON.parse(raw);
      } catch {}
      const burnedWif = Number(BigInt(g.cost) * BigInt(g.count) / 10n ** 16n) / 100;
      return json({
        kind, id, title: g.title, signKind: g.kind, creator: g.creator, contract: s.deployment.gate,
        created: g.created ?? (g.start || undefined), total: rows.length, count: g.count, burnedWif,
        exportedAt: Math.floor(Date.now() / 1000),
        rows: rows.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((r, i) => ({
          no: r.position ?? (i + 1), wallet: r.wallet, name: names[r.wallet.toLowerCase()] || '',
          ts: r.ts, block: r.block, tx: r.tx, passId: r.passId, detail: r.detail,
        })),
      }, 200, { 'cache-control': 'no-store' });
    }
    if (path === '/api/pass/name' && req.method === 'POST') {
      if (!secret) return noSecret();
      if (!env.kv) return json({ error: 'not available' }, 503);
      let body: any = {};
      try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      const auth = await prove(body.message, body.signature);
      if ('err' in auth && auth.err) return auth.err;
      const ch = 'ch' in auth ? auth.ch : undefined;
      const gateId = String(body.gateId ?? body.id ?? '');
      const name = String(body.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
      if (!ch || ch.purpose !== 'private-pass' || !gateId || !/^[\w .\-']{1,40}$/.test(name)) return json({ error: 'bad request' }, 400);
      const g = s.gates?.find((x) => String(x.id) === gateId);
      const acted = g?.actors.some((a) => a.who.toLowerCase() === ch.address.toLowerCase());
      if (!g || !acted) return unauth();
      let names: Record<string, string> = {};
      try {
        const raw = await env.kv.get(`passnames:${gateId}`);
        if (raw) names = JSON.parse(typeof raw === 'string' ? raw : '{}');
      } catch {}
      names[ch.address.toLowerCase()] = name;
      await env.kv.put(`passnames:${gateId}`, JSON.stringify(names));
      return json({ ok: true, name }, 200, { 'cache-control': 'no-store' });
    }

    const stocksRole = (r: string): Exclude<PassRole, 'signed'> | null => ({ voted: 'voted', bought: 'bought', sold: 'sold', cashed: 'cashed', profit: 'profit' } as Record<string, Exclude<PassRole, 'signed'>>)[r] ?? null;
    sm = /\/api\/(?:card|og)\/stocks\/(voted|bought|sold|cashed|profit)(?:\.svg)?$/.exec(path);
    if (sm) {
      const role = stocksRole(sm[1])!;
      const q = cardMeta(url.searchParams);
      const rawX = url.searchParams.get('x') ?? '';
      const seed = /^0x[0-9a-fA-F]{16,}$/.test(rawX) ? rawX : undefined;
      const detail = url.searchParams.get('detail') ?? undefined;
      const title = url.searchParams.get('title') ?? 'Flatland Stocks';
      const value = url.searchParams.get('value'), cost = url.searchParams.get('cost'), pct = url.searchParams.get('pct');
      const profit = value && cost && pct ? { value, cost, pct } : undefined;
      const input = { role, title, detail, wallet: q.wallet, ts: q.ts, seed, profit, burnedWif: role === 'voted' ? 1 : undefined };
      const wide = path.includes('/api/og/');
      return svgRes(wide ? stocksSvg(input) : stocksPoster(input));
    }

    
    sm = /\/api\/card\/private\/signed\/(\d+)(?:\.svg)?$/.exec(path);
    if (sm) {
      const auth = await prove();
      if ('err' in auth && auth.err) return auth.err;
      const ch = 'ch' in auth ? auth.ch! : undefined as any;
      if (!ch || (ch.purpose !== 'private-pass' && ch.purpose !== `creator:gate:${sm[1]}`)) return unauth();
      const g = (s.gates ?? []).find((x) => x.id === Number(sm![1]));
      if (!g) return json({ error: 'not found' }, 404);
      const actor = g.actors.find((a) => a.who.toLowerCase() === ch.address.toLowerCase());
      const rawX = url.searchParams.get('x') ?? '';
      const tx = actor?.tx ?? (/^0x[0-9a-fA-F]{16,}$/.test(rawX) ? rawX : '');
      if (!tx || !secret) return json({ error: 'not indexed yet' }, 409);
      const passId = await makePassId(secret, s.deployment.chainId, s.deployment.gate, `gate:${g.id}`, ch.address, tx);
      const input = { role: 'signed' as const, title: g.title, wallet: ch.address, passId, txHash: tx, block: actor?.block, ts: actor?.ts, detail: actor ? `#${actor.position + 1}` : undefined, kind: g.kind, seed: tx, burnedWif: Number(BigInt(g.cost) / 10n ** 16n) / 100 };
      return svgRes(privatePoster(input));
    }

    const page = (title: string, desc: string, image: string, url: string, dest: string) => {
      const esc2 = (x: string) => x.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      const tw = env.staticTwitterImage ? appUrl + '/og-default.png' : image;
      return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc2(title)} — Flatland</title>
<meta property="og:type" content="website"><meta property="og:title" content="${esc2(title)}"><meta property="og:description" content="${esc2(desc)}"><meta property="og:image" content="${image}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:url" content="${url}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc2(title)}"><meta name="twitter:description" content="${esc2(desc)}"><meta name="twitter:image" content="${tw}">
<meta http-equiv="refresh" content="0; url=${dest}"></head><body><a href="${dest}">Open →</a><script>location.replace(${JSON.stringify(dest)})</script></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=30' } });
    };
    sm = /\/share\/score\/(0x[0-9a-fA-F]{40})$/.exec(path);
    if (sm) { const { f } = scoreCard(sm[1]); return page(`Flat Score ${f.score} — ${shortA(sm[1])}`, `${f.tierName} tier · ${f.votes + f.acts} votes & acts · ${f.streak}-week streak${f.rank ? ` · rank #${f.rank} of ${f.of}` : ''}. What is yours?`, `${appUrl}/api/og/score/${sm[1]}.svg`, `${appUrl}/share/score/${sm[1]}`, `${appUrl}/#/score/${sm[1]}`); }
    sm = /\/share\/voted\/(\d+)\/(\d+)(?:\/(\d+))?$/.exec(path);
    if (sm) { const c = await votedCard(Number(sm[1]), Number(sm[2]), sm[3] ? Number(sm[3]) : undefined); if (!c) return new Response('Not found', { status: 404 }); const o = c.p.options[Number(sm[2])]; const q = url.search; const ogPath = `/api/og/voted/${sm[1]}/${sm[2]}${sm[3] ? '/' + sm[3] : ''}.svg${q}`; const sharePath = `/share/voted/${sm[1]}/${sm[2]}${sm[3] ? '/' + sm[3] : ''}${q}`; return page(`I voted ${o.name} — ${c.e.title}`, `I burned $WIF to vote ${o.letter} — ${o.name}. 1 wallet = 1 vote. Cast yours.`, `${appUrl}${ogPath}`, `${appUrl}${sharePath}`, `${appUrl}/#/e/${sm[1]}?vote=${sm[2]}`); }
    sm = /\/share\/signed\/(\d+)(?:\/(\d+))?$/.exec(path);
    if (sm) { const c = signedCard(Number(sm[1]), sm[2] ? Number(sm[2]) : undefined); if (!c) return new Response('Not found', { status: 404 }); const q = url.search; const og = `/api/og/signed/${sm[1]}${sm[2] ? '/' + sm[2] : ''}.svg${q}`; const share = `/share/signed/${sm[1]}${sm[2] ? '/' + sm[2] : ''}${q}`; return page(`${c.headline} — Flatland Sign`, `${c.headline}. Each act burns $WIF, is capped at one per wallet, and builds the actor's on-chain streak.`, `${appUrl}${og}`, `${appUrl}${share}`, `${appUrl}/#/rails/${sm[1]}`); }

    m = /\/(?:api\/)?share\/(\d+)$/.exec(path) ?? /\/v\/(\d+)\/(\d+)$/.exec(path);
    if (m) {
      const e = s.elections.find((x) => x.id === Number(m![1]));
      if (!e) return new Response('Not found', { status: 404 });
      const opt = m[2] !== undefined ? Number(m[2]) : -1; // /v/<id>/<opt>: one-tap vote link for an option
      if (opt >= e.options.length) return new Response('Not found', { status: 404 });
      const media = await loadMedia(env.kv, e.metaURI);
      const p = publicElection(s, e, appUrl, media);
      const total = p.options.reduce((a, o) => a + o.votes, 0);
      const lead = p.options.slice().sort((a, b) => b.votes - a.votes)[0];
      const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      const burnedWif = Number(BigInt(e.burned) / 10n ** 18n).toLocaleString('en-US');
      const tally = p.options.map((o) => `${o.letter} ${o.name} ${o.votes}`).join(' · ');
      const head = total ? `${lead.name} leads with ${Math.round(lead.share * 100)}% · ${total} votes · ${burnedWif} $WIF burned.` : '1 wallet = 1 vote. Every vote burns $WIF. Be the first to vote.';
      const desc = (opt >= 0 ? `Tap to vote ${p.options[opt].letter} — ${p.options[opt].name}. ` : '') + head + ' ' + tally;
      const dest = opt >= 0 ? `${appUrl}/#/e/${e.id}?vote=${opt}` : `${appUrl}/#/e/${e.id}`;
      const pageUrl = opt >= 0 ? `${appUrl}/v/${e.id}/${opt}` : p.share;
      const title = opt >= 0 ? `Vote ${p.options[opt].name} — ${e.title}` : e.title;
      const pic = (opt >= 0 && p.options[opt].image) || p.options.find((o) => o.image)?.image || null; // degrade to the live SVG / static PNG card when no image
      const ogImg = pic ?? p.ogImage;
      const card = pic ? 'summary' : 'summary_large_image';
      const twImg = pic ?? (env.staticTwitterImage ? appUrl + '/og-default.png' : p.ogImage);
      const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} — Flatland</title>
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${ogImg}">${pic ? '' : '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'}<meta property="og:url" content="${pageUrl}">
<meta name="twitter:card" content="${card}"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${twImg}">
<meta http-equiv="refresh" content="0; url=${dest}"></head><body><a href="${dest}">Open the election →</a><script>location.replace(${JSON.stringify(dest)})</script></body></html>`;
      return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=30' } });
    }
    return json({ error: 'not found', routes: ['/api/stats', '/api/score/:address', '/share/score/:address', '/share/voted/:id/:opt', '/share/signed/:id', '/api/card/voted/:id/:opt', '/api/card/signed/:id', '/api/card/stocks/:role', '/api/pass/challenge', '/api/pass/verify', '/api/pass/list', '/api/elections', '/api/elections/:id', '/api/og/:id.png', '/api/share/:id', 'POST /api/mcp'] }, 404);
  } catch (e) {
    return json({ error: (e as Error).message }, 502, { 'cache-control': 'no-store' });
  }
}
export { depositAddress };
