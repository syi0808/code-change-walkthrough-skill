#!/usr/bin/env node
// Run the walkthrough engine CLI (`code-walkthrough`) from anywhere, on
// macOS, Linux and Windows. Always invoke as:  node <skill>/scripts/engine.mjs <command> ...
//
// Resolution order:
//   1. $CODE_WALKTHROUGH_ENGINE   path to the engine's bin/code-walkthrough.mjs (or its package dir)
//   2. the engine next to this skill in its source repo (symlinks/junctions are followed)
//   3. a global npm install of `code-walkthrough-engine` (npm root -g)
// The engine is loaded in-process with the current Node binary, so no shell,
// PATH lookup or Windows .cmd shim is involved.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BIN = path.join('bin', 'code-walkthrough.mjs');

function fromEnv() {
  const v = process.env.CODE_WALKTHROUGH_ENGINE;
  if (!v) return null;
  const p = path.resolve(v);
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return path.join(p, BIN);
  return p;
}

function besideSkill() {
  const here = path.dirname(fs.realpathSync(fileURLToPath(import.meta.url)));
  return path.resolve(here, '..', '..', '..', 'packages', 'engine', BIN);
}

function globalNpm() {
  const r = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0 || !r.stdout) return null;
  return path.join(r.stdout.trim(), 'code-walkthrough-engine', BIN);
}

const candidates = [fromEnv(), besideSkill()];
let engine = candidates.find((p) => p && fs.existsSync(p));
if (!engine) { const g = globalNpm(); if (g && fs.existsSync(g)) engine = g; }

if (!engine) {
  console.error([
    'code-walkthrough engine not found. Fix one of:',
    '  - npm install -g <code-change-walkthrough repo>/packages/engine',
    '  - set CODE_WALKTHROUGH_ENGINE=<repo>/packages/engine/bin/code-walkthrough.mjs',
    '  - link this skill from its source repo (node <repo>/install.mjs)',
  ].join('\n'));
  process.exit(127);
}

// Hand over to the engine CLI in-process: it reads process.argv.slice(2).
process.argv = [process.argv[0], engine, ...process.argv.slice(2)];
await import(pathToFileURL(engine).href);
