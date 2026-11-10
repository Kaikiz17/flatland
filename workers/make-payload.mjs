// Generates the JS payloads that were run through the Cloudflare connector (`execute`, cloudflare.request()) to deploy
// without wrangler (npm run build:workers first). Equivalent to `wrangler deploy` with workers/*/wrangler.toml.
//   node workers/make-payload.mjs web      <KV_ID> > /tmp/deploy-web.js        (script PUT; static files are embedded)
//   node workers/make-payload.mjs tallier  <KV_ID> > /tmp/deploy-tallier.js    (script PUT, keeps the TALLIER_KEY secret)
// The tallier secret is set separately and NEVER stored in the repo (see workers/README.md).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const [, , which, kvId, extra] = process.argv;
const root = new URL('..', import.meta.url).pathname;
const compat = { compatibility_date: '2026-10-01', compatibility_flags: ['nodejs_compat'] };

if (which === 'web') {
  const worker = readFileSync(join(root, 'workers/dist/web.js'), 'utf8');
  const metadata = {
    main_module: 'index.js', ...compat, observability: { enabled: true },
    bindings: [{ type: 'kv_namespace', name: 'KV', namespace_id: kvId }, { type: 'plain_text', name: 'RPC_URL', text: 'https://rpc.mainnet.chain.robinhood.com' }],
  };
  console.log(`async () => {
  const metadata = ${JSON.stringify(metadata)};
  const worker = ${JSON.stringify(worker)};
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('index.js', new Blob([worker], { type: 'application/javascript+module' }), 'index.js');
  const res = await cloudflare.request({ method: 'PUT', path: \`/accounts/\${accountId}/workers/scripts/flatland\`, body: form });
  return { success: res.success, startup: res.result && res.result.startup_time_ms, etag: res.result && res.result.etag };
}`);
} else if (which === 'tallier') {
  const worker = readFileSync(join(root, 'workers/dist/tallier.js'), 'utf8');
  const metadata = {
    main_module: 'index.js', ...compat, observability: { enabled: true }, keep_bindings: ['secret_text'],
    bindings: [
      { type: 'kv_namespace', name: 'KV', namespace_id: kvId },
      { type: 'plain_text', name: 'RPC_URL', text: 'https://rpc.mainnet.chain.robinhood.com' },
      { type: 'plain_text', name: 'APP_URL', text: extra },
    ],
  };
  console.log(`async () => {
  const metadata = ${JSON.stringify(metadata)};
  const worker = ${JSON.stringify(worker)};
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('index.js', new Blob([worker], { type: 'application/javascript+module' }), 'index.js');
  const res = await cloudflare.request({ method: 'PUT', path: \`/accounts/\${accountId}/workers/scripts/flatland-tallier\`, body: form });
  return { success: res.success, startup: res.result && res.result.startup_time_ms, etag: res.result && res.result.etag };
}`);
} else { console.error('usage: make-payload.mjs web|tallier <kvId> [appUrl]'); process.exit(1); }
