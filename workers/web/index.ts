/**
 * Flatland edge app: ONE Cloudflare Worker = static web app (Workers Assets) + JSON API / MCP / OG cards / share pages.
 * Runs on the free plan (10 ms CPU, 50 subrequests): the heavy chain read is done by the cron tallier worker and parked in KV,
 * so API requests are KV reads. If the tallier snapshot is missing/stale, the API falls back to a (batched) direct RPC read.
 */
import { handle } from '../../api/_lib/handler.ts';
import deployment from '../../deployments/robinhood-mainnet.json';
import { STATIC } from './assets.gen.ts';

interface Env {
  KV: KVNamespace;
  RPC_URL?: string;
}

const STALE_MS = 30 * 60_000;
const cors = { 'access-control-allow-origin': '*' };

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
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, '') || '/';

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
      return new Response(JSON.stringify({ ok: !!st && Date.now() - (st.lastBeat ?? 0) < STALE_MS, state: st, status }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });
    }

    if (p.startsWith('/api/') || p === '/api' || p.startsWith('/share/')) {
      return handle(req, {
        APP_URL: url.origin,
        RPC_URL: env.RPC_URL,
        deployment: deployment as any,
        staticTwitterImage: true,
        getSnapshot: async () => {
          const [snap, st] = await Promise.all([env.KV.get('snapshot', { type: 'json', cacheTtl: 30 }) as Promise<any>, state(env)]);
          if (!snap || !st || Date.now() - (st.lastFull ?? 0) > STALE_MS) return null;
          snap.generatedAt = Math.floor((st.lastFull ?? Date.now()) / 1000);
          return snap;
        },
      });
    }
    return serveStatic(req, p);
  },
};
