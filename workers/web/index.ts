/**
 * Flatland edge app: ONE Cloudflare Worker = static web app (Workers Assets) + JSON API / MCP / OG cards / share pages.
 * Runs on the free plan (10 ms CPU, 50 subrequests): the heavy chain read is done by the cron tallier worker and parked in KV,
 * so API requests are KV reads. If the tallier snapshot is missing/stale, the API falls back to a (batched) direct RPC read.
 */
import { handle } from '../../api/_lib/handler.ts';
import deployment from '../../deployments/robinhood-mainnet.json';
import { STATIC } from './assets.gen.ts';
import { handleMedia } from '../../api/_lib/media.ts';

interface Env {
  KV: KVNamespace;
  RPC_URL?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  PASS_SECRET?: string;
}

const STALE_MS = 45 * 60_000;
const cors = { 'access-control-allow-origin': '*' };

/** Short Cache API TTL for hot public GETs. Not KV, so it does not count toward the free daily cap. */
function cacheTtl(method: string, p: string): number {
  if (method !== 'GET' && method !== 'HEAD') return 0;
  if (p.startsWith('/api/pass') || p.startsWith('/api/telegram') || p.includes('/private/')) return 0;
  if (p === '/api/img' || p === '/api/meta' || p === '/api' || p.startsWith('/api/mcp')) return 0;
  if (p === '/api/stats' || p === '/api/elections' || /^\/api\/elections\/\d+$/.test(p)) return 20;
  if (p.startsWith('/api/elections/') && p.endsWith('/audit')) return 30;
  if (p.startsWith('/data/groups/')) return 30;
  if (p.startsWith('/api/og/') || p.startsWith('/api/card/')) return 30;
  if (p.startsWith('/share/') || p.startsWith('/v/')) return 30;
  return 0;
}

async function withCache(req: Request, p: string, ctx: ExecutionContext, run: () => Promise<Response>): Promise<Response> {
  const ttl = cacheTtl(req.method, p);
  if (!ttl) return run();
  try {
    const cache = await caches.open('flatland-api');
    const key = new Request(req.url, { method: 'GET' });
    const hit = await cache.match(key);
    if (hit) {
      const at = Number(hit.headers.get('x-flatland-cached-at') || 0);
      if (at && Date.now() - at < ttl * 1000) {
        const headers = new Headers(hit.headers);
        headers.set('x-flatland-cache', 'hit');
        return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
      }
    }
    const res = await run();
    if (!res.ok) return res;
    const headers = new Headers(res.headers);
    headers.set('x-flatland-cached-at', String(Date.now()));
    headers.set('x-flatland-cache', 'miss');
    const out = new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    ctx.waitUntil(cache.put(key, out.clone()).catch(() => {}));
    return out;
  } catch {
    return run();
  }
}

async function state(env: Env): Promise<any | null> {
  return env.KV.get('state', { type: 'json', cacheTtl: 30 });
}

const CORS_STATIC = /^\/(flatland-widget\.js|config\.json|deployment[^/]*\.json)$/;

function serveStatic(req: Request, p: string): Response {
  const path = p === '/' ? '/index.html' : p;
  const f = STATIC[path] ?? STATIC[path + '.html'];
  if (!f) return new Response('Not found', { status: 404 });
  const hashed = path.startsWith('/assets/'); // vite fingerprints these
  const headers: Record<string, string> = {
    'content-type': f.type,
    etag: `"${f.etag}"`,
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : path === '/flatland-widget.js' ? 'public, max-age=300' : 'public, max-age=30',
    'x-content-type-options': 'nosniff',
  };
  if (CORS_STATIC.test(path)) headers['access-control-allow-origin'] = '*';
  if (req.headers.get('if-none-match') === headers.etag) return new Response(null, { status: 304, headers });
  const body = req.method === 'HEAD' ? null : f.bin ? Uint8Array.from(atob(f.body), (c) => c.charCodeAt(0)) : f.body;
  return new Response(body, { headers });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, '') || '/';
    return withCache(req, p, ctx, () => serve(req, env, ctx, url, p));
  },
};

async function serve(req: Request, env: Env, ctx: ExecutionContext, url: URL, p: string): Promise<Response> {

    // public audit export (Merkle entries + sybil groups) written by the tallier; also the on-chain `groupURI` target
    const audit = /^\/(?:api\/elections\/(\d+)\/audit|data\/groups\/(\d+)\.json)$/.exec(p);
    if (audit) {
      const body = await env.KV.get(`audit:${audit[1] ?? audit[2]}`, { cacheTtl: 30 });
      return body
        ? new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=30', ...cors } })
        : new Response(JSON.stringify({ error: 'no audit export yet' }), { status: 404, headers: { 'content-type': 'application/json', ...cors } });
    }

    // tallier / cron status (never contains secrets)
    if (p === '/api/status' || p === '/health') {
      const [st, status] = await Promise.all([state(env), env.KV.get('status', { type: 'json', cacheTtl: 30 })]);
      const prizeRules = (deployment as { prizeRules?: string }).prizeRules ?? null;
      return new Response(JSON.stringify({ ok: !!st && Date.now() - (st.lastBeat ?? 0) < STALE_MS, state: st, status, prizeRules }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });
    }

    // option images + election metadata blobs (KV, immutable, content-addressed)
    if (p === '/api/img' || p === '/api/meta' || p.startsWith('/img/') || p.startsWith('/m/')) {
      try {
        const r = await handleMedia(req, env.KV, p);
        if (r) return r;
      } catch (e) { return new Response(JSON.stringify({ error: 'media error' }), { status: 500, headers: { 'content-type': 'application/json' } }); }
    }

    if (p.startsWith('/api/') || p === '/api' || p.startsWith('/share/') || p.startsWith('/v/')) {
      return handle(req, {
        kv: env.KV,
        TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN,
        TELEGRAM_WEBHOOK_SECRET: env.TELEGRAM_WEBHOOK_SECRET,
        PASS_SECRET: env.PASS_SECRET,
        APP_URL: url.origin,
        RPC_URL: env.RPC_URL ?? 'https://4663.rpc.thirdweb.com',
        deployment: deployment as any,
        staticTwitterImage: true,
        getSnapshot: async (opts) => {
          const [snap, st] = await Promise.all([env.KV.get('snapshot', { type: 'json', cacheTtl: 30 }) as Promise<any>, state(env)]);
          if (!snap) return null;
          const stale = !st || Date.now() - (st.lastFull ?? 0) > STALE_MS;
          if (stale && !opts?.allowStale) return null;
          snap.generatedAt = Math.floor((st?.lastFull ?? Date.now()) / 1000);
          return snap;
        },
      }, ctx);
    }
    return serveStatic(req, p);
}
