// collect: change context for authoring a walkthrough. Writes the full JSON outside
// the repository and prints a compact digest.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collect, digest } from '../analyze/collect.ts';
import * as G from '../repo/git.ts';
import { parseArgs, str } from './args.ts';

const HELP = `collect: change context for authoring a walkthrough

  node collect.mjs [--repo DIR] [--range A..B | A...B] [--base REF] [--head REF|WORKTREE]
                   [--out DIR|FILE.json] [--max-refs 25] [--json]

  --repo      repository (default: current directory)
  --range     A..B (direct) or A...B (from merge-base)
  --base/head explicit refs; --head WORKTREE = uncommitted working tree
              (default: WORKTREE vs HEAD if dirty, else HEAD~1..HEAD)
  --out       directory or .json path (default: <OS temp dir>/code-walkthrough/<repo>-<sha>/)
  --max-refs  references kept per changed symbol (default 25)
  --json      print the full JSON instead of the digest`;

function main(argv: string[]): void {
  const a = parseArgs(argv, ['json', 'help', 'h']);
  if (a.help || a.h) { console.log(HELP); return; }
  const dir = path.resolve(str(a.repo) || process.cwd());
  if (!fs.existsSync(dir)) { console.error(`collect: no such directory: ${dir}`); process.exit(2); }
  if (G.git(dir, ['rev-parse', '--show-toplevel'], { allowFail: true }) === null) { console.error(`collect: not a git repository: ${dir} (pass --repo <dir>)`); process.exit(2); }

  const context = collect({ repo: dir, range: str(a.range), base: str(a.base), head: str(a.head), maxRefs: Number(str(a['max-refs']) || 25) });

  let out = str(a.out) ? path.resolve(str(a.out)!) : path.join(os.tmpdir(), 'code-walkthrough', `${path.basename(context.repo)}-${String(context.range.headSha).slice(0, 8)}`, 'context.json');
  if (!/\.json$/i.test(out) || (fs.existsSync(out) && fs.statSync(out).isDirectory())) out = path.join(out, 'context.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(context, null, 2));
  process.stdout.write(a.json ? JSON.stringify(context, null, 2) : digest(context, out));
}

try { main(process.argv.slice(2)); } catch (e) {
  const msg = (e as Error).message;
  console.error(`collect: ${msg}`);
  if (/Unknown (base|head) ref/.test(msg)) console.error('hint: shallow clone? try `git fetch --unshallow` or `git fetch origin <ref>`');
  process.exit(1);
}
