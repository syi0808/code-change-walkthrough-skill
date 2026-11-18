#!/usr/bin/env node
// Link the authoring skill into Claude Code (macOS, Linux and Windows). The skill's
// scripts are self-contained bundles, so linking is all it needs.
//   node install.mjs          link the skill
//   node install.mjs --cli    also build the engine and install the `code-walkthrough` CLI globally
// Skills directory: $CLAUDE_SKILLS_DIR or ~/.claude/skills
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.join(ROOT, 'packages', 'engine');
const SKILL_SRC = path.join(ROOT, 'skills', 'code-change-walkthrough');
const SKILLS_DIR = process.env.CLAUDE_SKILLS_DIR || path.join(os.homedir(), '.claude', 'skills');
const win = process.platform === 'win32';
const npm = (args) => spawnSync('npm', args, { cwd: ENGINE, stdio: 'inherit', shell: win }).status === 0;

if (process.argv.includes('--cli')) {
  console.log('→ building the engine and installing the CLI (code-walkthrough) globally');
  if (!npm(['install']) || !npm(['run', 'build']) || !npm(['install', '-g', '.'])) { console.error('✗ CLI install failed (the skill does not need it)'); process.exit(1); }
}

fs.mkdirSync(SKILLS_DIR, { recursive: true });
const target = path.join(SKILLS_DIR, 'code-change-walkthrough');
let st = null;
try { st = fs.lstatSync(target); } catch { /* absent */ }
if (st) {
  if (!st.isSymbolicLink()) { console.error(`✗ ${target} exists and is not a link: remove it first`); process.exit(1); }
  fs.rmSync(target, { recursive: false, force: true });
}
// Windows: a directory junction needs no admin rights or developer mode.
fs.symlinkSync(SKILL_SRC, target, win ? 'junction' : 'dir');
console.log(`→ linked skill: ${target} -> ${SKILL_SRC}`);

const check = spawnSync(process.execPath, [path.join(target, 'scripts', 'engine.mjs'), 'version'], { encoding: 'utf8' });
if (check.status === 0) console.log(`✓ the skill runs its engine (${check.stdout.trim()})`);
else { console.error('✗ the skill could not run its engine:\n' + check.stderr); process.exit(1); }
