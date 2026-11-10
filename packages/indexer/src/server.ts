import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FlatlandService } from './service.js';

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
const bigintSafe = (_: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

export function startServer(svc: FlatlandService, port: number) {
  const clients = new Set<import('node:http').ServerResponse>();
  let lastKey = '';
  // SSE: push a compact "pulse" whenever something new happens (votes, burns) — drives live election rooms.
  setInterval(() => {
    const s = svc.latest;
    if (!s) return;
    const key = `${s.totals.votes}:${s.totals.wifBurned}:${s.elections.length}:${s.gates.length}`;
    if (key === lastKey) return;
    lastKey = key;
    const ev = `event: snapshot\ndata: ${JSON.stringify({ totals: s.totals, head: s.head, at: s.generatedAt })}\n\n`;
    for (const c of clients) c.write(ev);
  }, 1000);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (code: number, body: unknown, type = 'application/json') => {
      res.writeHead(code, { 'content-type': type, ...cors });
      res.end(typeof body === 'string' ? body : JSON.stringify(body, bigintSafe));
    };
    if (req.method === 'OPTIONS') return send(204, '');
    const s = svc.latest;
    if (url.pathname === '/health') return send(200, { ok: !!s, head: s?.head, generatedAt: s?.generatedAt, tallier: s?.tallier });
    if (url.pathname === '/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', ...cors });
      res.write(': hello\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (!s) return send(503, { error: 'warming up' });
    if (url.pathname === '/snapshot.json') return send(200, s);
    const m = /^\/api\/elections\/(\d+)(\/audit)?$/.exec(url.pathname);
    if (url.pathname === '/api/elections') return send(200, s.elections.map((e) => ({ ...e, analysis: s.analysis[e.id] })));
    if (m) {
      const e = s.elections.find((x) => x.id === Number(m[1]));
      if (!e) return send(404, { error: 'no such election' });
      if (m[2]) {
        const f = join(svc.cfg.dataDir, 'groups', `${e.id}.json`);
        return existsSync(f) ? send(200, readFileSync(f, 'utf8')) : send(404, { error: 'no audit export yet' });
      }
      return send(200, { ...e, analysis: s.analysis[e.id] });
    }
    const g = /^\/data\/groups\/(\d+)\.json$/.exec(url.pathname);
    if (g) {
      const f = join(svc.cfg.dataDir, 'groups', `${g[1]}.json`);
      return existsSync(f) ? send(200, readFileSync(f, 'utf8')) : send(404, { error: 'not found' });
    }
    send(404, { error: 'not found' });
  });
  server.listen(port, '0.0.0.0');
  return server;
}
