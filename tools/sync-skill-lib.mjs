#!/usr/bin/env node
// The skill must be self-contained (it is symlinked into ~/.claude/skills), so
// it vendors the engine's language-agnostic heuristics. The engine is the
// single source of truth: run this after editing packages/engine/src/lib.
//   node tools/sync-skill-lib.mjs          copy engine lib -> skill lib
//   node tools/sync-skill-lib.mjs --check  exit 1 if they drifted
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'packages/engine/src/lib');
const dst = path.join(root, 'skills/code-change-walkthrough/scripts/lib');
const header = '// VENDORED from packages/engine/src/lib — do not edit here; run tools/sync-skill-lib.mjs\n';
let drift = 0;
fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(src).filter((x) => x.endsWith('.mjs'))) {
  const want = header + fs.readFileSync(path.join(src, f), 'utf8');
  const target = path.join(dst, f);
  const have = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  if (have === want) continue;
  drift++;
  if (process.argv.includes('--check')) console.error(`drift: ${f}`);
  else { fs.writeFileSync(target, want); console.log(`synced ${f}`); }
}
if (process.argv.includes('--check')) { console.log(drift ? `${drift} file(s) drifted` : 'in sync'); process.exit(drift ? 1 : 0); }
