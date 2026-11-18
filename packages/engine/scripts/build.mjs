#!/usr/bin/env node
// Build: the player (Svelte, once) -> inlined into the engine bundles -> dist/ (npm package)
// and the skill's scripts/ (minified, self-contained). Compiling an IR later only fills
// the prebuilt template with data; it never runs this build.
//
//   node scripts/build.mjs           build everything
//   node scripts/build.mjs --check   fail if the skill's bundled scripts are out of date
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as esbuild from 'esbuild';
import sveltePlugin from 'esbuild-svelte';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = path.resolve(ROOT, '..', '..', 'skills', 'code-change-walkthrough', 'scripts');
const check = process.argv.includes('--check');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const r = (...p) => path.join(ROOT, ...p);

// ---- 1. the player: one IIFE + one stylesheet
const player = await esbuild.build({
  entryPoints: [r('src/player/main.ts')],
  bundle: true, write: false, outdir: r('.player'), format: 'iife', minify: true, legalComments: 'none',
  target: ['es2020', 'chrome100', 'firefox100', 'safari15'],
  conditions: ['svelte', 'browser', 'production'], mainFields: ['svelte', 'browser', 'module', 'main'],
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [sveltePlugin({ compilerOptions: { css: 'external', dev: false } })],
  logLevel: 'warning',
});
const out = (ext) => player.outputFiles.find((f) => f.path.endsWith(ext)).text;
const assets = { template: fs.readFileSync(r('src/player/template.html'), 'utf8'), css: out('.css'), js: out('.js') };

// ---- 2. engine + collect bundles, with the player and docs inlined
const virtual = {
  name: 'virtual',
  setup(b) {
    b.onResolve({ filter: /^virtual:/ }, (a) => ({ path: a.path, namespace: 'virtual' }));
    b.onLoad({ filter: /.*/, namespace: 'virtual' }, (a) => {
      if (a.path === 'virtual:player') return { contents: Object.entries(assets).map(([k, v]) => `export const ${k} = ${JSON.stringify(v)};`).join('\n'), loader: 'js' };
      if (a.path === 'virtual:docs') return { contents: `export const spec = ${JSON.stringify(fs.readFileSync(r('docs/ir-v1.md'), 'utf8'))};\nexport const schema = ${JSON.stringify(fs.readFileSync(r('schema/walkthrough-ir.v1.schema.json'), 'utf8'))};\nexport const version = ${JSON.stringify(pkg.version)};`, loader: 'js' };
      return null;
    });
  },
};
const node = (entry, opts) => esbuild.build({
  entryPoints: [r(entry)], bundle: true, write: false, platform: 'node', format: 'esm', target: 'node18',
  outfile: 'out.mjs', plugins: [virtual], logLevel: 'warning', legalComments: 'none', ...opts,
}).then((x) => x.outputFiles[0].text);

const SHEBANG = '#!/usr/bin/env node\n';
const GENERATED = (src) => `// GENERATED from packages/engine/${src} by scripts/build.mjs: do not edit, run \`npm run build\`.\n`;
const skillFiles = {
  'engine.mjs': SHEBANG + GENERATED('src/cli/engine.ts') + await node('src/cli/engine.ts', { minify: true }),
  'collect.mjs': SHEBANG + GENERATED('src/cli/collect.ts') + await node('src/cli/collect.ts', { minify: true }),
};

if (check) {
  const stale = Object.entries(skillFiles).filter(([f, text]) => { try { return fs.readFileSync(path.join(SKILL, f), 'utf8') !== text; } catch { return true; } }).map(([f]) => f);
  if (stale.length) { console.error(`skill scripts out of date: ${stale.join(', ')}\nrun: npm --prefix packages/engine run build`); process.exit(1); }
  console.log('skill scripts up to date');
  process.exit(0);
}

const distFiles = {
  'cli.mjs': SHEBANG + await node('src/cli/engine.ts', {}),
  'collect.mjs': SHEBANG + await node('src/cli/collect.ts', {}),
  'index.mjs': await node('src/index.ts', {}),
};
fs.rmSync(r('dist'), { recursive: true, force: true });
fs.mkdirSync(r('dist'), { recursive: true });
for (const [f, text] of Object.entries(distFiles)) fs.writeFileSync(r('dist', f), text, { mode: f === 'index.mjs' ? 0o644 : 0o755 });
// library types: declarations for the public API, with `.ts` specifiers rewritten for consumers
execFileSync(process.execPath, [r('node_modules/typescript/bin/tsc'), '-p', r('tsconfig.build.json')], { stdio: 'inherit' });
for (const f of fs.readdirSync(r('dist/types'), { recursive: true })) {
  const p = r('dist/types', String(f));
  if (p.endsWith('.d.ts')) fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/(from\s+['"]\.{1,2}\/[^'"]+)\.ts(['"])/g, '$1.js$2'));
}
fs.mkdirSync(SKILL, { recursive: true });
for (const [f, text] of Object.entries(skillFiles)) fs.writeFileSync(path.join(SKILL, f), text, { mode: 0o755 });
const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
console.log(`player: js ${kb(assets.js)}, css ${kb(assets.css)}`);
for (const [f, t] of Object.entries(skillFiles)) console.log(`skill/scripts/${f}: ${kb(t)}`);
for (const [f, t] of Object.entries(distFiles)) console.log(`dist/${f}: ${kb(t)}`);
