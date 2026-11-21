import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const packageDist = resolve(root, 'node_modules/jassub/dist');
const publicRoot = resolve(root, 'public/jassub');

await rm(publicRoot, { recursive: true, force: true });
await mkdir(resolve(publicRoot, 'worker'), { recursive: true });
await mkdir(resolve(publicRoot, 'wasm'), { recursive: true });

await build({
  entryPoints: [resolve(packageDist, 'worker/worker.js')],
  outfile: resolve(publicRoot, 'worker/worker.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'external',
});

await cp(resolve(packageDist, 'wasm'), resolve(publicRoot, 'wasm'), { recursive: true });
await cp(resolve(packageDist, 'default.woff2'), resolve(publicRoot, 'default.woff2'));
await cp(resolve(packageDist, 'LICENSE'), resolve(publicRoot, 'LICENSE'));
console.log('Prepared self-hosted JASSUB worker, WASM variants, default font and license.');
