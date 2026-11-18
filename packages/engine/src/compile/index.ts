// Compiler: authoring IR -> compiled IR. Validates the IR, resolves sources (git or
// inline), expands the tour, resolves anchors to concrete lines and embeds file
// contents. A pure library: no process exits and no console output.
import fs from 'node:fs';
import path from 'node:path';
import * as G from '../repo/git.ts';
import { detectLanguage, isGeneratedFile } from '../repo/lang.ts';
import type { Table } from '../i18n/index.ts';
import { totalMs } from '../shared/timing.ts';
import { dirIndex } from '../shared/tree-path.ts';
import type { Diagnostic, Side, Tree, Walkthrough } from '../ir/types.ts';
import { CompileContext } from './context.ts';
import { resolveScenes } from './steps.ts';
import { expandTour, stepFiles } from './tour.ts';
import { buildTree } from './tree.ts';

export const IR_VERSION = 1;
const MAX_BYTES = 600_000;

/** `i18n`: the UI string table for the walkthrough's language (none: English). */
export interface CompileOptions { repo?: string; baseDir?: string; extraFiles?: boolean; tree?: boolean; i18n?: Table | null }
export interface ResolvedAnchor { path: string; do: string; file: string; side: Side; from: number; to: number; view?: string; text: string }
export interface CompileStats {
  chapters: number;
  scenes: number;
  files: number;
  tour: { hunks: number; files: number } | null;
  estimatedSeconds: number;
  unnarratedFiles: string[];
  /** Unchanged files the walkthrough shows (callers, definitions, consumers): its context outside the diff. */
  outsideDiff: string[];
}
export interface CompileResult { ok: boolean; ir: Walkthrough; errors: Diagnostic[]; warnings: Diagnostic[]; stats: CompileStats; resolved: ResolvedAnchor[]; i18n: Table | null }

export function compile(input: unknown, opts: CompileOptions = {}): CompileResult {
  const ir = JSON.parse(JSON.stringify(input)) as Walkthrough;
  const i18n = opts.i18n || null;
  const cx = new CompileContext(ir, i18n);
  const lang = ir.meta?.language || 'en';
  if (!/^en\b/i.test(lang) && !i18n) cx.warn('meta.language', `"${lang}" has no UI string table: the player's buttons and labels stay in English. Install one with \`engine.mjs i18n ${lang}\` (or pass --i18n FILE)`);
  else if (i18n && i18n.language.split('-')[0].toLowerCase() !== lang.split(/[-_]/)[0].toLowerCase()) cx.warn('meta.language', `the UI string table is "${i18n.language}" but the walkthrough is "${lang}"`);

  // ---------------------------------------------------------------- sources
  if (ir.version !== 1) cx.warn('version', `expected 1, got ${ir.version}`);
  const src = ir.source || {};
  let repo = opts.repo || (src.repo ? path.resolve(opts.baseDir || process.cwd(), src.repo) : null);
  let range: G.Range | null = null;
  if (repo) {
    try {
      repo = G.repoRoot(path.resolve(repo));
      range = G.resolveRange(repo, { range: src.range, base: src.base, head: src.head });
    } catch (e) { cx.err('source', (e as Error).message); }
  }
  ir.files = ir.files || {};
  ir.chapters = ir.chapters || [];

  // every changed file is included so the viewer can explore beyond the narrated path
  if (repo && range && opts.extraFiles !== false) {
    for (const f of G.changedFiles(repo, range)) {
      const cur = ir.files[f.path];
      if (!cur) ir.files[f.path] = { status: f.status, oldPath: f.oldPath, unnarrated: true };
      else if (!cur.status) cur.status = f.status;
      if (f.oldPath && !ir.files[f.path].oldPath) ir.files[f.path].oldPath = f.oldPath;
    }
  }
  // files referenced by steps but missing from `files` become context files
  for (const ch of ir.chapters) for (const sc of ch.scenes || []) for (const st of sc.steps || []) {
    for (const file of stepFiles(st)) if (!ir.files[file]) { ir.files[file] = { status: 'context' }; cx.warn('files', `"${file}" used in steps but not declared: added as context`); }
  }
  for (const [p, f] of Object.entries(ir.files)) {
    f.status = f.status || 'context';
    f.language = f.language || detectLanguage(p);
    if (f.before === undefined) f.before = f.status === 'added' ? null : repo && range ? G.readAt(repo, range.base, f.oldPath || p) : null;
    if (f.after === undefined) f.after = f.status === 'deleted' ? null : repo && range ? G.readAt(repo, range.head, p) : null;
    if (f.status === 'context') {
      if (f.after == null && f.before != null) f.after = f.before;
      if (f.before == null && f.after != null) f.before = f.after;
    }
    if (f.before == null && f.after == null) {
      if (isGeneratedFile(p) || f.unnarrated) { delete ir.files[p]; continue; }
      cx.err(`files["${p}"]`, 'content not found (check path, source.base/head, or provide before/after inline)');
    }
    for (const side of ['before', 'after'] as const) {
      const t = f[side];
      if (!t || t.length <= MAX_BYTES) continue;
      if (f.unnarrated) { delete ir.files[p]; break; }
      cx.warn(`files["${p}"]`, `${side} is ${(t.length / 1024) | 0}KB: consider narrating a smaller file`);
    }
  }

  // ---------------------------------------------------------------- scenes
  // the explorer's tree, as the player will show it: picking a file walks its folders
  let tree: Tree | undefined;
  if (repo && range && opts.tree !== false) {
    try { tree = buildTree(repo, range, ir.files); } catch (e) { cx.warn('tree', `file tree unavailable: ${(e as Error).message}`); }
  }
  cx.dirs = dirIndex([...(tree ? tree.files.map(([d, n]) => (tree!.dirs[d] ? `${tree!.dirs[d]}/${n}` : n)) : []), ...Object.keys(ir.files)], tree?.partial || []);
  expandTour(cx);
  resolveScenes(cx);

  // ---------------------------------------------------------------- context outside the diff
  // A diff shows what was edited, not what the edit reaches. Say it, even when it is "nothing".
  const effects = new Set(['safe', 'check', 'breaks', 'updated']);
  if (!ir.meta?.impact?.length) cx.warn('meta.impact', 'empty: list what outside the diff this change reaches (callers, data, config, other services) and how, or say that nothing does');
  (ir.meta?.impact || []).forEach((n, i) => {
    if (!n || typeof n.text !== 'string') cx.err(`meta.impact[${i}]`, 'needs "text"');
    else if (n.effect !== undefined && !effects.has(n.effect)) cx.err(`meta.impact[${i}]`, `effect must be one of ${[...effects].join('|')}`);
    for (const f of n?.files || []) if (!ir.files[f]) cx.warn(`meta.impact[${i}]`, `"${f}" is not in files: it will not be openable`);
  });

  // ---------------------------------------------------------------- report
  const resolved = resolvedReport(cx);
  const touched = new Set<string>();
  for (const ch of ir.chapters) for (const sc of ch.scenes || []) for (const st of sc.steps || []) {
    for (const f of stepFiles(st)) touched.add(f);
    if (st._file) touched.add(st._file);
    if (st.do === 'graph') for (const n of st.nodes || []) if (n.file) touched.add(n.file);
  }
  const stats: CompileStats = {
    chapters: ir.chapters.length,
    scenes: ir.chapters.reduce((a, c) => a + (c.scenes || []).length, 0),
    files: Object.keys(ir.files).length,
    tour: ir.tourStats || null,
    estimatedSeconds: Math.round(totalMs(ir) / 1000),
    unnarratedFiles: Object.entries(ir.files).filter(([p, f]) => f.status !== 'context' && !touched.has(p)).map(([p]) => p),
    outsideDiff: Object.entries(ir.files).filter(([p, f]) => f.status === 'context' && touched.has(p)).map(([p]) => p),
  };
  if (!cx.errors.length) {
    if (tree) ir.tree = tree;
    ir.source = { ...(ir.source || {}), ...(range ? { base: range.base, head: range.head, baseSha: range.baseSha.slice(0, 10), headSha: range.headSha === G.WORKTREE ? G.WORKTREE : range.headSha.slice(0, 10) } : {}) };
    delete ir.source.repo; // never leak absolute local paths into a shareable page
    for (const f of Object.values(ir.files)) delete f.unnarrated;
    ir.compiled = { engineIrVersion: IR_VERSION, at: new Date().toISOString() };
  }
  return { ok: cx.errors.length === 0, ir, errors: cx.errors, warnings: cx.warnings, stats, resolved, i18n };
}

/** Where every anchor landed, so an author can check placement and not just existence. */
function resolvedReport(cx: CompileContext): ResolvedAnchor[] {
  const out: ResolvedAnchor[] = [];
  const text = (file: string, side: Side, line: number) => cx.lineText(file, side, line).trim().slice(0, 120);
  cx.ir.chapters.forEach((ch, ci) => (ch.scenes || []).forEach((sc, si) => (sc.steps || []).forEach((st, ti) => {
    const W = `chapters[${ci}].scenes[${si}](${sc.id}).steps[${ti}]`;
    const file = st._file || st.file;
    if (st._r && file) out.push({ path: W, do: st.do, file, side: st._r.side, from: st._r.from, to: st._r.to, text: text(file, st._r.side, st._r.from) });
    const fr = st._from;
    if (fr && fr.line && fr.side) out.push({ path: W + '.from', do: 'goto', file: fr.file, side: fr.side, from: fr.line, to: fr.line, text: text(fr.file, fr.side, fr.line) });
    const to = st._to;
    if (to && to.line && to.side) out.push({ path: W + '.to', do: 'goto', file: to.file, side: to.side, from: to.from!, to: to.to!, view: to.view, text: text(to.file, to.side, to.from!) });
    (st._items || []).forEach((it, k) => out.push({ path: `${W}.items[${k}]`, do: 'refs', file: it.file, side: it.side, from: it.line, to: it.line, text: it.text }));
  })));
  return out;
}

/** Read and compile an IR file (a relative source.repo resolves against the file's directory). */
export function compileFile(file: string, opts: CompileOptions = {}): CompileResult {
  const input: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  return compile(input, { baseDir: path.dirname(path.resolve(file)), ...opts });
}
