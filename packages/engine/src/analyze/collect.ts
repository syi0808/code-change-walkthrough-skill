// Change context for authoring a walkthrough. Goes beyond `git diff`: changed
// symbols, who references them (fan-in), what changed files import (fan-out),
// dependency clusters, suggested reading orders and a complexity estimate.
import path from 'node:path';
import * as G from '../repo/git.ts';
import * as L from '../repo/lang.ts';

export interface CollectOptions { repo: string; range?: string; base?: string; head?: string; maxRefs?: number }

interface HunkInfo extends G.Hunk { enclosing: string | null; defines: string[] }
interface ChangedSymbol { name: string; kind: string; change: 'added' | 'removed' | 'modified'; side: 'before' | 'after'; line: number; endLine: number }
export interface FileInfo extends G.ChangedFile {
  language: string;
  isTest: boolean;
  isGenerated: boolean;
  linesBefore: number;
  linesAfter: number;
  hunks: HunkInfo[];
  symbolsChanged: ChangedSymbol[];
  imports: string[];
  importsAdded?: string[];
  importsRemoved?: string[];
}
interface Reference { file: string; line: number; text: string; enclosing: string | null; inChangedFile: boolean; viaImport: boolean; isTest: boolean; likelyHomonym: boolean }
interface SymbolEntry extends ChangedSymbol {
  id: string;
  file: string;
  references: Reference[];
  refCount: number;
  linkedRefCount?: number;
  possibleHomonyms?: number;
  truncated?: boolean;
  ambiguous: boolean;
  skipReason?: string;
}
interface GraphNode { id: string; changed: boolean; status: string; isTest: boolean }
interface GraphEdge { from: string; to: string; kind: 'imports' | 'uses'; symbol?: string }

export interface ChangeContext {
  tool: string;
  generatedAt: string;
  repo: string;
  range: G.Range;
  commits: { sha: string; subject: string; body: string }[];
  stats: { files: number; coreFiles: number; additions: number; deletions: number; hunks: number; clusters: number; crossFileReferences: number };
  complexity: { score: number; band: 'small' | 'medium' | 'large' };
  files: FileInfo[];
  symbols: SymbolEntry[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  suggestions: { entryPoints: string[]; bottomUpOrder: string[]; topDownOrder: string[]; clusters: string[][] };
}

const COMMON = new Set(['get', 'set', 'init', 'run', 'main', 'index', 'default', 'render', 'handle', 'update', 'create', 'delete', 'test', 'setup', 'value', 'data', 'name', 'type', 'id', 'call', 'apply', 'build', 'start', 'stop', 'new', 'from', 'to']);

export function collect(o: CollectOptions): ChangeContext {
  const repo = G.repoRoot(o.repo);
  const range = G.resolveRange(repo, { range: o.range, base: o.base, head: o.head });
  const maxRefs = o.maxRefs || 25;
  const universe = new Set(G.listFiles(repo, range.head));
  const dirIndex = new Map<string, string[]>();
  for (const f of universe) {
    const d = path.posix.dirname(f);
    if (!dirIndex.has(d)) dirIndex.set(d, []);
    dirIndex.get(d)!.push(f);
  }
  const resolveAll = (from: string, text: string | null) => {
    const out = new Set<string>();
    for (const spec of L.extractImports(text)) for (const r of L.resolveImport(from, spec, universe, dirIndex)) out.add(r);
    return out;
  };

  // ---------- per-file analysis
  const files: FileInfo[] = G.changedFiles(repo, range).map((cf) => {
    const f: FileInfo = { ...cf, language: L.detectLanguage(cf.path), isTest: L.isTestFile(cf.path), isGenerated: L.isGeneratedFile(cf.path), linesBefore: 0, linesAfter: 0, hunks: [], symbolsChanged: [], imports: [] };
    const before = f.status === 'added' ? null : G.readAt(repo, range.base, f.oldPath || f.path);
    const after = f.status === 'deleted' ? null : G.readAt(repo, range.head, f.path);
    f.linesBefore = before === null ? 0 : before.split('\n').length;
    f.linesAfter = after === null ? 0 : after.split('\n').length;
    if (f.isGenerated || f.binary) return f;

    const symAfter = L.extractSymbols(after, f.language);
    const symBefore = L.extractSymbols(before, f.language);
    f.hunks = G.hunks(repo, range, f).map((h) => {
      // enclosing: the symbol that contains the hunk and starts before it
      // defines: symbols whose definition line falls inside the hunk
      const side = h.newLines > 0 ? symAfter : symBefore;
      const start = h.newLines > 0 ? h.newStart : h.oldStart;
      const len = h.newLines > 0 ? h.newLines : h.oldLines;
      const enc = L.enclosingSymbol(side.filter((x) => x.line < start), start);
      const defines = side.filter((x) => x.line >= start && x.line < start + Math.max(len, 1)).map((x) => x.name);
      return { ...h, enclosing: enc ? enc.name : null, defines };
    });

    // symbols touched by the change, classified added / removed / modified
    const touched = new Map<string, L.SymbolDef>();
    const hit = (s: L.SymbolDef, a: number, b: number) => s.line <= b && a <= s.endLine;
    for (const h of f.hunks) {
      const aA = h.newStart, aB = h.newStart + Math.max(h.newLines, 1) - 1;
      const bA = h.oldStart, bB = h.oldStart + Math.max(h.oldLines, 1) - 1;
      for (const s of symAfter) if ((h.newLines > 0 && hit(s, aA, aB)) || (h.newLines === 0 && hit(s, aA, aA))) touched.set(s.name, s);
      for (const s of symBefore) if (h.oldLines > 0 && hit(s, bA, bB) && !touched.has(s.name)) touched.set(s.name, s);
    }
    const beforeNames = new Set(symBefore.map((s) => s.name));
    const afterNames = new Set(symAfter.map((s) => s.name));
    f.symbolsChanged = [...touched.values()].map((s) => {
      const change = !beforeNames.has(s.name) ? 'added' : !afterNames.has(s.name) ? 'removed' : 'modified';
      return { name: s.name, kind: s.kind, change, side: change === 'removed' ? 'before' : 'after', line: s.line, endLine: s.endLine };
    });

    const imports = resolveAll(f.path, after ?? before);
    imports.delete(f.path);
    f.imports = [...imports];
    if (before !== null && after !== null) {
      const prev = resolveAll(f.oldPath || f.path, before);
      f.importsAdded = f.imports.filter((x) => !prev.has(x));
      f.importsRemoved = [...prev].filter((x) => !imports.has(x));
    }
    return f;
  });

  // ---------- cross-file references (fan-in)
  const changedSet = new Set(files.map((f) => f.path));
  const symCache = new Map<string, L.SymbolDef[]>();
  const symbolsOf = (file: string) => {
    if (!symCache.has(file)) { const t = G.readAt(repo, range.head, file); symCache.set(file, t === null ? [] : L.extractSymbols(t, L.detectLanguage(file))); }
    return symCache.get(file)!;
  };
  const importCache = new Map<string, Set<string>>();
  const importsOf = (file: string) => {
    if (!importCache.has(file)) importCache.set(file, resolveAll(file, G.readAt(repo, range.head, file)));
    return importCache.get(file)!;
  };
  const symbols: SymbolEntry[] = [];
  for (const f of files) {
    for (const s of f.symbolsChanged) {
      const entry: SymbolEntry = { id: `${f.path}#${s.name}`, file: f.path, ...s, references: [], refCount: 0, ambiguous: false };
      symbols.push(entry);
      if (s.name.length < 3 || COMMON.has(s.name.toLowerCase())) { entry.ambiguous = true; entry.skipReason = 'common name'; continue; }
      if (f.isTest) { entry.skipReason = 'test-local'; continue; }
      const hits = G.grepWord(repo, range.head, s.name, { limit: maxRefs * 4 });
      const dir = path.posix.dirname(f.path);
      const refs = hits.filter((h) => !(h.file === f.path && h.line === s.line)).map((h) => {
        const viaImport = h.file !== f.path && importsOf(h.file).has(f.path);
        const inChangedFile = changedSet.has(h.file);
        const sameDir = path.posix.dirname(h.file) === dir;
        const isTest = L.isTestFile(h.file);
        // import-linked > same file/dir > changed > elsewhere (likely homonyms); tests last within a tier
        const rank = (viaImport ? 0 : h.file === f.path ? 2 : sameDir ? 3 : inChangedFile ? 4 : 6) + (inChangedFile ? -0.5 : 0) + (isTest ? 0.3 : 0);
        return { ...h, viaImport, inChangedFile, isTest, rank };
      }).sort((a, b) => a.rank - b.rank);
      entry.truncated = hits.length > maxRefs * 4;
      entry.refCount = refs.length;
      entry.linkedRefCount = refs.filter((h) => h.rank < 6).length;
      entry.possibleHomonyms = refs.length - entry.linkedRefCount;
      entry.references = refs.slice(0, maxRefs).map((h) => {
        const enc = L.enclosingSymbol(symbolsOf(h.file), h.line);
        return { file: h.file, line: h.line, text: h.text, enclosing: enc ? enc.name : null, inChangedFile: h.inChangedFile, viaImport: h.viaImport, isTest: h.isTest, likelyHomonym: h.rank >= 6 };
      });
    }
  }

  // ---------- dependency graph
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const addNode = (p: string) => { if (!nodes.has(p)) nodes.set(p, { id: p, changed: changedSet.has(p), status: files.find((f) => f.path === p)?.status || 'context', isTest: L.isTestFile(p) }); };
  for (const f of files) {
    addNode(f.path);
    for (const imp of f.imports) { addNode(imp); edges.push({ from: f.path, to: imp, kind: 'imports' }); }
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
  const find = (x: string): string => { const p = parent.get(x)!; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
  for (const e of edges) if (changedSet.has(e.from) && changedSet.has(e.to)) parent.set(find(e.from), find(e.to));
  const clusterMap = new Map<string, string[]>();
  for (const p of changedSet) { const r = find(p); if (!clusterMap.has(r)) clusterMap.set(r, []); clusterMap.get(r)!.push(p); }
  const clusters = [...clusterMap.values()].sort((a, b) => b.length - a.length);

  // reading orders among changed (non-generated) files
  const core = files.filter((f) => !f.isGenerated).map((f) => f.path);
  const deps = new Map(core.map((p) => [p, new Set<string>()]));
  for (const e of edges) if (deps.has(e.from) && deps.has(e.to) && e.from !== e.to) deps.get(e.from)!.add(e.to);
  const bottomUp = topo(core, deps); // dependencies before dependents
  const dependents = new Map(core.map((p) => [p, 0]));
  // tests importing a file must not hide it as an entry point
  for (const [from, ds] of deps) if (!L.isTestFile(from)) for (const d of ds) dependents.set(d, dependents.get(d)! + 1);
  const entryPoints = core.filter((p) => dependents.get(p) === 0 && !L.isTestFile(p));

  const totalAdd = files.reduce((a, f) => a + (f.additions || 0), 0);
  const totalDel = files.reduce((a, f) => a + (f.deletions || 0), 0);
  const totalHunks = files.reduce((a, f) => a + f.hunks.length, 0);
  const crossRefs = symbols.reduce((a, s) => a + s.references.filter((r) => r.file !== s.file && !r.likelyHomonym).length, 0);
  const score = Math.round(core.length * 2 + totalHunks + (totalAdd + totalDel) / 25 + clusters.length * 2 + Math.min(crossRefs, 40) / 4);

  return {
    tool: 'code-change-walkthrough/collect',
    generatedAt: new Date().toISOString(),
    repo,
    range,
    commits: G.commits(repo, range),
    stats: { files: files.length, coreFiles: core.length, additions: totalAdd, deletions: totalDel, hunks: totalHunks, clusters: clusters.length, crossFileReferences: crossRefs },
    complexity: { score, band: score < 12 ? 'small' : score < 40 ? 'medium' : 'large' },
    files,
    symbols,
    graph: { nodes: [...nodes.values()], edges },
    suggestions: { entryPoints, bottomUpOrder: bottomUp, topDownOrder: [...bottomUp].reverse(), clusters },
  };
}

function topo(list: string[], depMap: Map<string, Set<string>>): string[] {
  const out: string[] = [];
  const state = new Map<string, number>();
  const visit = (n: string) => {
    if (state.has(n)) return; // done, or a cycle: break it
    state.set(n, 1);
    for (const d of depMap.get(n) || []) visit(d);
    state.set(n, 2); out.push(n);
  };
  for (const n of list) visit(n);
  return out;
}

/** A compact digest of the context for reading in a terminal. */
export function digest(c: ChangeContext, out: string): string {
  const L2: string[] = [];
  L2.push(`# Change context  (${c.range.base} → ${c.range.head})`);
  L2.push(`full JSON: ${out}`);
  L2.push(`complexity: ${c.complexity.band} (score ${c.complexity.score}) · files ${c.stats.files} · +${c.stats.additions} −${c.stats.deletions} · hunks ${c.stats.hunks} · clusters ${c.stats.clusters} · cross-file refs ${c.stats.crossFileReferences}`);
  if (c.commits.length) { L2.push('', '## commits'); for (const m of c.commits.slice(0, 15)) L2.push(`- ${m.sha} ${m.subject}`); }
  L2.push('', '## files');
  for (const f of c.files) {
    const tags = [f.status, f.language, f.isTest && 'test', f.isGenerated && 'generated', f.binary && 'binary'].filter(Boolean).join(', ');
    L2.push(`- ${f.oldPath ? `${f.oldPath} → ` : ''}${f.path}  [${tags}]  +${f.additions ?? '?'} −${f.deletions ?? '?'}`);
    for (const h of f.hunks.slice(0, 12)) L2.push(`    @@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines}${h.enclosing ? `  in ${h.enclosing}` : ''}${h.defines.length ? `  defines ${h.defines.slice(0, 4).join(', ')}${h.defines.length > 4 ? ' …' : ''}` : ''}`);
    if (f.hunks.length > 12) L2.push(`    … ${f.hunks.length - 12} more hunks`);
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
