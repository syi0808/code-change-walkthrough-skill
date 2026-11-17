#!/usr/bin/env node
// Layer 1 (analysis): collect codebase context for a change.
//
// Goes beyond `git diff`: changed symbols, who references them (fan-in),
// what changed files import (fan-out), dependency clusters, a suggested
// reading order and a complexity estimate. Output is a JSON "context" file
// the LLM reads to design the explanation, plus a compact digest on stdout.
//
// Usage:
//   node collect.mjs [--repo DIR] [--range A..B | A...B] [--base REF] [--head REF|WORKTREE]
//                    [--out context.json] [--max-refs 25] [--json]
// Default output: <OS temp dir>/code-walkthrough/<repo>-<head>/context.json (never inside the repo).
// --out accepts a directory (context.json is written inside it) or a .json file path.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as G from './lib/git.mjs';
import * as L from './lib/lang.mjs';

process.on('uncaughtException', (e) => { console.error(`collect: ${e.message}`); if (/Unknown (base|head) ref/.test(e.message)) console.error('hint: shallow clone? try `git fetch --unshallow` or `git fetch origin <ref>`'); process.exit(1); });
const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  console.log(`collect.mjs: change context for authoring a walkthrough

  node collect.mjs [--repo DIR] [--range A..B | A...B] [--base REF] [--head REF|WORKTREE]
                   [--out DIR|FILE.json] [--max-refs 25] [--json]

  --repo      repository (default: current directory)
  --range     A..B (direct) or A...B (from merge-base)
  --base/head explicit refs; --head WORKTREE = uncommitted working tree
              (default: WORKTREE vs HEAD if dirty, else HEAD~1..HEAD)
  --out       directory or .json path (default: <OS temp dir>/code-walkthrough/<repo>-<sha>/)
  --max-refs  references kept per changed symbol (default 25)
  --json      print the full JSON instead of the digest`);
  process.exit(0);
}
const repoArg = path.resolve(args.repo || process.cwd());
if (!fs.existsSync(repoArg)) { console.error(`collect: no such directory: ${repoArg}`); process.exit(2); }
if (G.git(repoArg, ['rev-parse', '--show-toplevel'], { allowFail: true }) === null) { console.error(`collect: not a git repository: ${repoArg} (pass --repo <dir>)`); process.exit(2); }
const repo = G.repoRoot(repoArg);
const range = G.resolveRange(repo, { range: args.range, base: args.base, head: args.head });
const maxRefs = Number(args['max-refs'] || 25);

const files = G.changedFiles(repo, range);
const universeHead = new Set(G.listFiles(repo, range.head));
const dirIndex = new Map();
for (const f of universeHead) {
  const d = path.posix.dirname(f);
  if (!dirIndex.has(d)) dirIndex.set(d, []);
  dirIndex.get(d).push(f);
}

// ---------- per-file analysis ----------
for (const f of files) {
  f.language = L.detectLanguage(f.path);
  f.isTest = L.isTestFile(f.path);
  f.isGenerated = L.isGeneratedFile(f.path);
  const before = f.status === 'added' ? null : G.readAt(repo, range.base, f.oldPath || f.path);
  const after = f.status === 'deleted' ? null : G.readAt(repo, range.head, f.path);
  f.linesBefore = before === null ? 0 : before.split('\n').length;
  f.linesAfter = after === null ? 0 : after.split('\n').length;
  if (f.isGenerated || f.binary) { f.hunks = []; f.symbolsChanged = []; f.imports = []; continue; }

  const symAfter = L.extractSymbols(after, f.language);
  const symBefore = L.extractSymbols(before, f.language);
  f.hunks = G.hunks(repo, range, f).map((h) => {
    // `enclosing`: the symbol that contains the hunk and starts BEFORE it.
    // `defines`: symbols whose definition line falls inside the hunk (added/rewritten here).
    const side = h.newLines > 0 ? symAfter : symBefore;
    const start = h.newLines > 0 ? h.newStart : h.oldStart;
    const len = h.newLines > 0 ? h.newLines : h.oldLines;
    const enc = L.enclosingSymbol(side.filter((x) => x.line < start), start);
    const defines = side.filter((x) => x.line >= start && x.line < start + Math.max(len, 1)).map((x) => x.name);
    return { ...h, enclosing: enc ? enc.name : null, defines };
  });

  // Symbols touched by the change, classified added / removed / modified.
  const touched = new Map();
  const hit = (s, a, b) => s.line <= b && a <= s.endLine;
  for (const h of f.hunks) {
    const aA = h.newStart, aB = h.newStart + Math.max(h.newLines, 1) - 1;
    const bA = h.oldStart, bB = h.oldStart + Math.max(h.oldLines, 1) - 1;
    for (const s of symAfter) if (h.newLines > 0 && hit(s, aA, aB) || (h.newLines === 0 && hit(s, aA, aA))) touched.set(s.name, { ...s, side: 'after' });
    for (const s of symBefore) if (h.oldLines > 0 && hit(s, bA, bB) && !touched.has(s.name)) touched.set(s.name, { ...s, side: 'before' });
  }
  const beforeNames = new Set(symBefore.map((s) => s.name));
  const afterNames = new Set(symAfter.map((s) => s.name));
  f.symbolsChanged = [...touched.values()].map((s) => {
    const change = !beforeNames.has(s.name) ? 'added' : !afterNames.has(s.name) ? 'removed' : 'modified';
    // drop containers that merely enclose a smaller touched symbol and are not themselves new
    return { name: s.name, kind: s.kind, change, side: change === 'removed' ? 'before' : 'after', line: s.line, endLine: s.endLine };
  });

  const imports = new Set();
  const src = after ?? before;
  for (const spec of L.extractImports(src)) for (const r of L.resolveImport(f.path, spec, universeHead, dirIndex)) if (r !== f.path) imports.add(r);
  f.imports = [...imports];
  if (before !== null && after !== null) {
    const prev = new Set();
    for (const spec of L.extractImports(before)) for (const r of L.resolveImport(f.oldPath || f.path, spec, universeHead, dirIndex)) prev.add(r);
    f.importsAdded = f.imports.filter((x) => !prev.has(x));
    f.importsRemoved = [...prev].filter((x) => !imports.has(x));
  }
}

// ---------- cross-file references (fan-in) ----------
const changedSet = new Set(files.map((f) => f.path));
const COMMON = new Set(['get', 'set', 'init', 'run', 'main', 'index', 'default', 'render', 'handle', 'update', 'create', 'delete', 'test', 'setup', 'value', 'data', 'name', 'type', 'id', 'call', 'apply', 'build', 'start', 'stop', 'new', 'from', 'to']);
const symCache = new Map();
function symbolsOf(file) {
  if (!symCache.has(file)) {
    const t = G.readAt(repo, range.head, file);
    symCache.set(file, t === null ? [] : L.extractSymbols(t, L.detectLanguage(file)));
  }
  return symCache.get(file);
}
const importCache = new Map();
function importsOf(file) {
  if (!importCache.has(file)) {
    const t = G.readAt(repo, range.head, file);
    const out = new Set();
    if (t !== null) for (const spec of L.extractImports(t)) for (const r of L.resolveImport(file, spec, universeHead, dirIndex)) out.add(r);
    importCache.set(file, out);
  }
  return importCache.get(file);
}
const symbols = [];
for (const f of files) {
  for (const s of f.symbolsChanged || []) {
    const id = `${f.path}#${s.name}`;
    const entry = { id, file: f.path, ...s, references: [], refCount: 0, ambiguous: false };
    symbols.push(entry);
    if (s.name.length < 3 || COMMON.has(s.name.toLowerCase())) { entry.ambiguous = true; entry.skipReason = 'common name'; continue; }
    if (f.isTest) { entry.skipReason = 'test-local'; continue; }
    const hits = G.grepWord(repo, range.head, s.name, { limit: maxRefs * 4 });
    const refs = hits.filter((h) => !(h.file === f.path && h.line === s.line));
    entry.truncated = hits.length > maxRefs * 4;
    const dir = path.posix.dirname(f.path);
    for (const h of refs) {
      h.viaImport = h.file !== f.path && importsOf(h.file).has(f.path);
      h.inChangedFile = changedSet.has(h.file);
      h.sameDir = path.posix.dirname(h.file) === dir;
      h.isTest = L.isTestFile(h.file);
      // rank: import-linked > same file/dir > changed > elsewhere (likely homonyms); tests last within a tier
      h.rank = (h.viaImport ? 0 : h.file === f.path ? 2 : h.sameDir ? 3 : h.inChangedFile ? 4 : 6) + (h.inChangedFile ? -0.5 : 0) + (h.isTest ? 0.3 : 0);
    }
    refs.sort((a, b) => a.rank - b.rank);
    const linked = refs.filter((h) => h.rank < 6);
    entry.refCount = refs.length;
    entry.linkedRefCount = linked.length;
    // when import resolution clearly works for this file and most hits are unlinked, treat them as homonyms
    entry.possibleHomonyms = refs.length - linked.length;
    entry.references = refs.slice(0, maxRefs).map((h) => {
      const enc = L.enclosingSymbol(symbolsOf(h.file), h.line);
      return { file: h.file, line: h.line, text: h.text, enclosing: enc ? enc.name : null, inChangedFile: h.inChangedFile, viaImport: h.viaImport, isTest: h.isTest, likelyHomonym: h.rank >= 6 };
    });
  }
}

// ---------- dependency graph ----------
const nodes = new Map();
const edges = [];
const addNode = (p) => { if (!nodes.has(p)) nodes.set(p, { id: p, changed: changedSet.has(p), status: files.find((f) => f.path === p)?.status || 'context', isTest: L.isTestFile(p) }); };
for (const f of files) {
  addNode(f.path);
  for (const imp of f.imports || []) { addNode(imp); edges.push({ from: f.path, to: imp, kind: 'imports' }); }
}
for (const s of symbols) {
  for (const r of s.references) {
    if (r.file === s.file || r.likelyHomonym) continue;
    addNode(r.file);
    if (!edges.some((e) => e.from === r.file && e.to === s.file)) edges.push({ from: r.file, to: s.file, kind: 'uses', symbol: s.name });
  }
}

// clusters among changed files (undirected connectivity)
const parent = new Map([...changedSet].map((p) => [p, p]));
const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
for (const e of edges) if (changedSet.has(e.from) && changedSet.has(e.to)) parent.set(find(e.from), find(e.to));
const clusterMap = new Map();
for (const p of changedSet) { const r = find(p); if (!clusterMap.has(r)) clusterMap.set(r, []); clusterMap.get(r).push(p); }
const clusters = [...clusterMap.values()].sort((a, b) => b.length - a.length);

// reading orders among changed (non-generated) files
const core = files.filter((f) => !f.isGenerated).map((f) => f.path);
const deps = new Map(core.map((p) => [p, new Set()]));
for (const e of edges) if (deps.has(e.from) && deps.has(e.to) && e.from !== e.to) deps.get(e.from).add(e.to);
const bottomUp = topo(core, deps); // dependencies before dependents
const dependents = new Map(core.map((p) => [p, 0]));
// tests importing a file must not hide it as an entry point
for (const [from, ds] of deps) if (!L.isTestFile(from)) for (const d of ds) dependents.set(d, dependents.get(d) + 1);
const entryPoints = core.filter((p) => dependents.get(p) === 0 && !L.isTestFile(p));

function topo(list, depMap) {
  const out = []; const state = new Map();
  const visit = (n) => {
    if (state.get(n) === 2) return; if (state.get(n) === 1) return; // cycle: break
    state.set(n, 1);
    for (const d of depMap.get(n) || []) visit(d);
    state.set(n, 2); out.push(n);
  };
  for (const n of list) visit(n);
  return out;
}

// complexity estimate
const totalAdd = files.reduce((a, f) => a + (f.additions || 0), 0);
const totalDel = files.reduce((a, f) => a + (f.deletions || 0), 0);
const totalHunks = files.reduce((a, f) => a + (f.hunks?.length || 0), 0);
const crossRefs = symbols.reduce((a, s) => a + s.references.filter((r) => r.file !== s.file && !r.likelyHomonym).length, 0);
const score = Math.round(core.length * 2 + totalHunks + (totalAdd + totalDel) / 25 + clusters.length * 2 + Math.min(crossRefs, 40) / 4);
const band = score < 12 ? 'small' : score < 40 ? 'medium' : 'large';

const context = {
  tool: 'code-change-walkthrough/collect',
  generatedAt: new Date().toISOString(),
  repo,
  range,
  commits: G.commits(repo, range),
  stats: { files: files.length, coreFiles: core.length, additions: totalAdd, deletions: totalDel, hunks: totalHunks, clusters: clusters.length, crossFileReferences: crossRefs },
  complexity: { score, band },
  files,
  symbols,
  graph: { nodes: [...nodes.values()], edges },
  suggestions: { entryPoints, bottomUpOrder: bottomUp, topDownOrder: [...bottomUp].reverse(), clusters },
};

let outPath = args.out ? path.resolve(args.out) : path.join(os.tmpdir(), 'code-walkthrough', `${path.basename(repo)}-${String(range.headSha).slice(0, 8)}`, 'context.json');
if (!/\.json$/i.test(outPath) || (fs.existsSync(outPath) && fs.statSync(outPath).isDirectory())) outPath = path.join(outPath, 'context.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(context, null, 2));

if (args.json) { process.stdout.write(JSON.stringify(context, null, 2)); process.exit(0); }
process.stdout.write(digest(context, outPath));

function digest(c, out) {
  const L2 = [];
  L2.push(`# Change context  (${c.range.base} → ${c.range.head})`);
  L2.push(`full JSON: ${out}`);
  L2.push(`complexity: ${c.complexity.band} (score ${c.complexity.score}) · files ${c.stats.files} · +${c.stats.additions} −${c.stats.deletions} · hunks ${c.stats.hunks} · clusters ${c.stats.clusters} · cross-file refs ${c.stats.crossFileReferences}`);
  if (c.commits.length) { L2.push('', '## commits'); for (const m of c.commits.slice(0, 15)) L2.push(`- ${m.sha} ${m.subject}`); }
  L2.push('', '## files');
  for (const f of c.files) {
    const tags = [f.status, f.language, f.isTest && 'test', f.isGenerated && 'generated', f.binary && 'binary'].filter(Boolean).join(', ');
    L2.push(`- ${f.oldPath ? `${f.oldPath} → ` : ''}${f.path}  [${tags}]  +${f.additions ?? '?'} −${f.deletions ?? '?'}`);
    for (const h of (f.hunks || []).slice(0, 12)) L2.push(`    @@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines}${h.enclosing ? `  in ${h.enclosing}` : ''}${h.defines && h.defines.length ? `  defines ${h.defines.slice(0, 4).join(', ')}${h.defines.length > 4 ? ' …' : ''}` : ''}`);
    if ((f.hunks || []).length > 12) L2.push(`    … ${f.hunks.length - 12} more hunks`);
    if (f.importsAdded?.length) L2.push(`    + imports: ${f.importsAdded.join(', ')}`);
    if (f.importsRemoved?.length) L2.push(`    − imports: ${f.importsRemoved.join(', ')}`);
  }
  L2.push('', '## changed symbols (fan-in)');
  for (const s of c.symbols) {
    const ext = s.references.filter((r) => r.file !== s.file && !r.likelyHomonym);
    const info = s.skipReason ? `(${s.skipReason}, refs skipped)` : `refs ${s.linkedRefCount}${s.truncated ? '+' : ''}${s.possibleHomonyms ? ` (+${s.possibleHomonyms} unlinked, likely homonyms)` : ''}`;
    L2.push(`- ${s.change.padEnd(8)} ${s.kind} ${s.name}  ${s.file}:${s.line}-${s.endLine}  ${info}`);
    for (const r of ext.slice(0, 6)) L2.push(`    ← ${r.file}:${r.line}${r.enclosing ? ` (${r.enclosing})` : ''}${r.viaImport ? ' [import]' : ''}${r.inChangedFile ? ' [changed]' : ''}${r.isTest ? ' [test]' : ''}  ${r.text.slice(0, 90)}`);
    if (ext.length > 6) L2.push(`    … ${ext.length - 6} more`);
  }
  L2.push('', '## structure');
  L2.push(`entry points (nothing changed depends on them): ${c.suggestions.entryPoints.join(', ') || '-'}`);
  L2.push(`bottom-up order: ${c.suggestions.bottomUpOrder.join(' → ')}`);
  c.suggestions.clusters.forEach((cl, i) => L2.push(`cluster ${i + 1}: ${cl.join(', ')}`));
  const ctx = c.graph.nodes.filter((n) => !n.changed);
  if (ctx.length) L2.push(`unchanged neighbours: ${ctx.slice(0, 20).map((n) => n.id).join(', ')}${ctx.length > 20 ? ` … +${ctx.length - 20}` : ''}`);
  return L2.join('\n') + '\n';
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) o[k] = argv[++i]; else o[k] = true;
  }
  return o;
}
