#!/usr/bin/env node
// Install the code-walkthrough engine CLI and link the authoring skill into
// Claude Code. Works on macOS, Linux and Windows.
//   node install.mjs            engine (npm -g) + skill link
//   node install.mjs --skill    skill link only (the skill then uses the engine in this repo)
// Skills directory: $CLAUDE_SKILLS_DIR or ~/.claude/skills
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SKILL_SRC = path.join(ROOT, 'skills', 'code-change-walkthrough');
const SKILLS_DIR = process.env.CLAUDE_SKILLS_DIR || path.join(os.homedir(), '.claude', 'skills');
const win = process.platform === 'win32';

if (!process.argv.includes('--skill')) {
  console.log('→ installing engine CLI (code-walkthrough) globally');
  const r = spawnSync('npm', ['install', '-g', path.join(ROOT, 'packages', 'engine')], { stdio: 'inherit', shell: win });
  if (r.status !== 0) { console.error('✗ npm install failed (re-run with --skill to only link the skill)'); process.exit(1); }
}

fs.mkdirSync(SKILLS_DIR, { recursive: true });
const target = path.join(SKILLS_DIR, 'code-change-walkthrough');
let st = null;
try { st = fs.lstatSync(target); } catch { /* absent */ }
if (st) {
  if (!st.isSymbolicLink()) { console.error(`✗ ${target} exists and is not a link: remove it first`); process.exit(1); }
  fs.rmSync(target, { recursive: false, force: true });
}
// Windows: a directory junction needs no admin rights / developer mode.
fs.symlinkSync(SKILL_SRC, target, win ? 'junction' : 'dir');
console.log(`→ linked skill: ${target} -> ${SKILL_SRC}`);

const check = spawnSync(process.execPath, [path.join(target, 'scripts', 'engine.mjs'), 'version'], { encoding: 'utf8' });
if (check.status === 0) console.log(`✓ engine reachable from the skill (${check.stdout.trim()})`);
else { console.error('✗ engine not reachable from the skill:\n' + check.stderr); process.exit(1); }
