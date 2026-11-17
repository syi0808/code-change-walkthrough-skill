#!/usr/bin/env node
// code-walkthrough: the Walkthrough engine CLI.
// Executes Walkthrough IR v1: validate it, compile it into a standalone HTML
// player, or serve that player on localhost. It does not analyse code or
// plan explanations; producing the IR is the job of an authoring agent/skill.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFile, render, IR_VERSION } from '../src/compile.mjs';
import { serve } from '../src/serve.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const HELP = `code-walkthrough ${PKG.version}: Walkthrough IR v${IR_VERSION} engine

Usage
  code-walkthrough check  <ir.json> [--repo DIR] [--json] [--resolve]
  code-walkthrough build  <ir.json> [-o out.html] [--repo DIR] [--json]
  code-walkthrough serve  <ir.json|player.html> [--port 4173] [--host 127.0.0.1] [--repo DIR] [--open] [--no-watch]
  code-walkthrough spec           print the IR v${IR_VERSION} reference (markdown)
  code-walkthrough schema         print the IR v${IR_VERSION} JSON Schema
  code-walkthrough version

Options
  --repo DIR         git repository used to resolve source.base/head and anchors
                     (default: source.repo relative to the IR file, else none)
  --no-extra-files   do not add un-narrated changed files to the file explorer
  --json             machine-readable diagnostics on stdout: {ok, errors, warnings, stats, resolved?, out?}
                     stats: chapters, scenes, files, estimatedSeconds (1x), unnarratedFiles
  --resolve          also report where every anchor landed (file, side, lines, line text)
  -o, --out FILE     output path for build (default: <ir>.html)

Exit codes: 0 ok · 1 IR errors · 2 usage / runtime error`;

const argv = process.argv.slice(2);
const cmd = argv[0];
const a = parseArgs(argv.slice(1));

main().catch((e) => { console.error(`code-walkthrough: ${e.message}`); process.exit(2); });

async function main() {
  switch (cmd) {
    case 'check': case 'build': {
      const file = need(a._[0], `${cmd} needs <ir.json>`);
      const res = compileFile(file, { repo: a.repo, extraFiles: !a['no-extra-files'] });
      let out = null;
      if (cmd === 'build' && res.ok) {
        out = path.resolve(a.out || a.o || file.replace(/\.json$/i, '') + '.html');
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, render(res.ir));
      }
      if (a.json) {
        process.stdout.write(JSON.stringify({ ok: res.ok, errors: res.errors, warnings: res.warnings, stats: res.stats, ...(a.resolve ? { resolved: res.resolved } : {}), ...(out ? { out } : {}) }, null, 2) + '\n');
      } else {
        for (const w of res.warnings) console.error(`warn  ${w.path}: ${w.message}`);
        for (const e of res.errors) console.error(`error ${e.path}: ${e.message}`);
        if (a.resolve) for (const r of res.resolved) console.error(`  ${r.path}  →  ${r.file}:${r.from}${r.to !== r.from ? `-${r.to}` : ''} (${r.side})  ${r.text}`);
        if (!res.ok) console.error(`\n✗ ${res.errors.length} error(s), ${res.warnings.length} warning(s)`);
        else {
          const m = Math.floor(res.stats.estimatedSeconds / 60), sec = res.stats.estimatedSeconds % 60;
          console.error(`✓ IR valid: ${res.stats.chapters} chapters, ${res.stats.scenes} scenes, ${res.stats.files} files, ~${m}:${String(sec).padStart(2, '0')} at 1x, ${res.warnings.length} warning(s)`);
          if (res.stats.unnarratedFiles.length) console.error(`  un-narrated changed files: ${res.stats.unnarratedFiles.join(', ')}`);
        }
        if (out) console.error(`→ ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
      }
      process.exit(res.ok ? 0 : 1);
    }
    case 'serve': {
      const file = need(a._[0], 'serve needs <ir.json> or <player.html>');
      if (!fs.existsSync(file)) throw new Error(`no such file: ${file}`);
      await serve({ input: file, repo: a.repo, port: a.port, host: a.host, open: !!a.open, watch: !a['no-watch'], extraFiles: !a['no-extra-files'] });
      return; // keep running
    }
    case 'spec': process.stdout.write(fs.readFileSync(path.join(ROOT, 'docs', 'ir-v1.md'), 'utf8')); return;
    case 'schema': process.stdout.write(fs.readFileSync(path.join(ROOT, 'schema', 'walkthrough-ir.v1.schema.json'), 'utf8')); return;
    case 'version': case '--version': case '-v': console.log(`${PKG.version} (IR v${IR_VERSION})`); return;
    case undefined: case 'help': case '--help': case '-h': console.log(HELP); return;
    default: console.error(`unknown command "${cmd}"\n\n${HELP}`); process.exit(2);
  }
}

function need(v, msg) { if (!v) { console.error(`${msg}\n\n${HELP}`); process.exit(2); } return v; }
function parseArgs(list) {
  const o = { _: [] };
  for (let i = 0; i < list.length; i++) {
    const x = list[i];
    if (x === '-o') { o.out = list[++i]; continue; }
    if (!x.startsWith('--')) { o._.push(x); continue; }
    const [k, v] = x.slice(2).split('=');
    if (v !== undefined) o[k] = v;
    else if (i + 1 < list.length && !list[i + 1].startsWith('-') && !['json', 'open', 'no-watch', 'no-extra-files', 'resolve'].includes(k)) o[k] = list[++i];
    else o[k] = true;
  }
  return o;
}
