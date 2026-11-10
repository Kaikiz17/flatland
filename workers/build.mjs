// Bundles both workers with esbuild -> workers/dist/{web,tallier}.js (ES modules, no wasm, no node polyfills needed)
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
for (const name of ['web', 'tallier']) {
  const r = await build({
    entryPoints: [`${root}workers/${name}/index.ts`], outfile: `${root}workers/dist/${name}.js`, bundle: true, format: 'esm',
    platform: 'browser', mainFields: ['browser', 'module', 'main'], conditions: ['workerd', 'worker', 'browser', 'import'], target: 'es2022', minify: true,
    external: ['node:*', '@resvg/resvg-js'], logLevel: 'warning', legalComments: 'none', metafile: true, loader: { '.txt': 'text' },
  });
  const bytes = Object.values(r.metafile.outputs)[0].bytes;
  console.log(name, (bytes / 1024).toFixed(0) + ' KB');
}
