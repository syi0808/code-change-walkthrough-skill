// code-walkthrough: the Walkthrough engine CLI. Validates IR, compiles it into a
// standalone HTML player, or serves that player on localhost. It does not analyse
// code or plan explanations; producing the IR is the authoring agent's job.
import fs from 'node:fs';
import path from 'node:path';
import { spec, schema, version } from 'virtual:docs';
import { compileFile, IR_VERSION } from '../compile/index.ts';
import { render } from '../render/render.ts';
import { serve } from '../serve/serve.ts';
import { parseArgs, str } from './args.ts';

const HELP = `code-walkthrough ${version}: Walkthrough IR v${IR_VERSION} engine

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
                     stats: chapters, scenes, files, tour, estimatedSeconds (1x), unnarratedFiles
  --resolve          also report where every anchor landed (file, side, lines, line text)
  -o, --out FILE     output path for build (default: <ir>.html)

Exit codes: 0 ok · 1 IR errors · 2 usage / runtime error`;

const BOOL = ['json', 'open', 'no-watch', 'no-extra-files', 'resolve'];

function need(v: string | undefined, msg: string): string {
  if (!v) { console.error(`${msg}\n\n${HELP}`); process.exit(2); }
  return v;
}

async function main(argv: string[]): Promise<void> {
  const cmd = argv[0];
  const a = parseArgs(argv.slice(1), BOOL, { '-o': 'out' });
  const repo = str(a.repo);
  const extraFiles = !a['no-extra-files'];
  switch (cmd) {
    case 'check': case 'build': {
      const file = need(a._[0], `${cmd} needs <ir.json>`);
      const res = compileFile(file, { repo, extraFiles });
      let out: string | null = null;
      if (cmd === 'build' && res.ok) {
        out = path.resolve(str(a.out) || file.replace(/\.json$/i, '') + '.html');
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
          const s = res.stats.estimatedSeconds;
          console.error(`✓ IR valid: ${res.stats.chapters} chapters, ${res.stats.scenes} scenes, ${res.stats.files} files, ~${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} at 1x, ${res.warnings.length} warning(s)`);
          if (res.stats.unnarratedFiles.length) console.error(`  un-narrated changed files: ${res.stats.unnarratedFiles.join(', ')}`);
        }
        if (out) console.error(`→ ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
      }
      process.exit(res.ok ? 0 : 1);
    }
    case 'serve': {
      const file = need(a._[0], 'serve needs <ir.json> or <player.html>');
      if (!fs.existsSync(file)) throw new Error(`no such file: ${file}`);
      await serve({ input: file, repo, port: str(a.port), host: str(a.host), open: !!a.open, watch: !a['no-watch'], extraFiles });
      return; // keeps running
    }
    case 'spec': process.stdout.write(spec); return;
    case 'schema': process.stdout.write(schema); return;
    case 'version': case '--version': case '-v': console.log(`${version} (IR v${IR_VERSION})`); return;
    case undefined: case 'help': case '--help': case '-h': console.log(HELP); return;
    default: console.error(`unknown command "${cmd}"\n\n${HELP}`); process.exit(2);
  }
}

main(process.argv.slice(2)).catch((e: Error) => { console.error(`code-walkthrough: ${e.message}`); process.exit(2); });
