// Bundles both workers with esbuild (ES modules, no wasm, no node polyfills needed)
//   workers/dist/web.js           single file
//   workers/dist/tallier/*.js     index.js (thin cron entry) + chunk-*.js (heavy full pass, dynamically imported)
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { rmSync, readdirSync } from 'node:fs';
const root = fileURLToPath(new URL('..', import.meta.url));
const common = { bundle: true, format: 'esm', platform: 'browser', mainFields: ['browser', 'module', 'main'], conditions: ['workerd', 'worker', 'browser', 'import'], target: 'es2022', minify: true, external: ['node:*', '@resvg/resvg-js'], logLevel: 'warning', legalComments: 'none', loader: { '.txt': 'text' } };
await build({ ...common, entryPoints: [`${root}workers/web/index.ts`], outfile: `${root}workers/dist/web.js` });
rmSync(`${root}workers/dist/tallier`, { recursive: true, force: true });
await build({ ...common, entryPoints: { index: `${root}workers/tallier/index.ts` }, outdir: `${root}workers/dist/tallier`, splitting: true, chunkNames: 'chunk-[hash]' });
console.log('web', 'ok', '| tallier modules:', readdirSync(`${root}workers/dist/tallier`).join(', '));
