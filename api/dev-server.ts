// Local Node server for the API surface:  INDEXER_URL=http://127.0.0.1:8787 APP_URL=http://127.0.0.1:5173 npx tsx api/dev-server.ts
import { createServer } from 'node:http';
import { join } from 'node:path';
import { handle } from './_lib/handler.ts';

const port = Number(process.env.API_PORT ?? 8788);
const env = { INDEXER_URL: process.env.INDEXER_URL, RPC_URL: process.env.RPC_URL, APP_URL: process.env.APP_URL, DEPLOYMENT_URL: process.env.DEPLOYMENT_URL, FONT_FILES: process.env.FONT_FILES ?? join(process.cwd(), 'api/assets/LiberationSans-Bold.ttf') };
createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const r = await handle(new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers as any, body: ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(chunks) }), env);
  res.writeHead(r.status, Object.fromEntries((r.headers as any).entries()));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => console.log('flatland api on :' + port));
