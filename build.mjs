import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/app.js'],
  bundle: true,
  splitting: true,
  format: 'esm',
  minify: true,
  target: 'es2022',
  outdir: 'dist',
  platform: 'browser',
  external: ['node:fs', 'node:path', 'node:fs/promises'],
  logLevel: 'warning',
});
for (const f of ['index.html', 'style.css', 'favicon.svg']) await copyFile(`src/${f}`, `dist/${f}`);
console.log('built dist/');
