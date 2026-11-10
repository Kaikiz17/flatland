// Local stand-in for the Cloudflare web worker: serves a built web dir + the media routes (in-memory KV) + the JSON API.
//   WEB_DIR=.demo/web INDEXER_URL=http://127.0.0.1:8787 PORT=5174 npx tsx scripts/dev-edge.mts
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { handle } from '../api/_lib/handler.ts';
import { handleMedia } from '../api/_lib/media.ts';

const dir = join(process.cwd(), process.env.WEB_DIR ?? '.demo/web');
const port = Number(process.env.PORT ?? 5174);
const store = new Map<string, any>();
const kv = { get: async (k: string, o?: any) => { const v = store.get(k); if (v == null) return null; return o?.type === 'arrayBuffer' ? (v as Uint8Array).buffer.slice((v as Uint8Array).byteOffset, (v as Uint8Array).byteOffset + (v as Uint8Array).byteLength) : v; }, put: async (k: string, v: any) => { store.set(k, v instanceof ArrayBuffer ? new Uint8Array(v) : v); } };
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
createServer(async (req, res) => {
  const origin = `http://${req.headers.host}`;
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const url = new URL(req.url!, origin);
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const mk = () => new Request(origin + req.url, { method: req.method, headers: req.headers as any, body: ['GET', 'HEAD'].includes(req.method!) ? undefined : Buffer.concat(chunks) });
  let r: Response | null = null;
  if (p === '/api/img' || p === '/api/meta' || p.startsWith('/img/') || p.startsWith('/m/')) r = await handleMedia(mk(), kv, p);
  if (!r && (p.startsWith('/api/') || p.startsWith('/share/') || p.startsWith('/v/'))) r = await handle(mk(), { kv, APP_URL: origin, INDEXER_URL: process.env.INDEXER_URL, staticTwitterImage: true });
  if (!r) {
    const f = join(dir, p === '/' ? 'index.html' : p);
    r = existsSync(f) && statSync(f).isFile() ? new Response(readFileSync(f), { headers: { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' } }) : new Response('nf', { status: 404 });
  }
  res.writeHead(r.status, Object.fromEntries((r.headers as any).entries()));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => console.log('dev-edge on :' + port));
