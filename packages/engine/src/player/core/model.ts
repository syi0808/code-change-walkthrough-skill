// Code models: every row of a file view, highlighted and diffed once and cached.
// Folding is applied per pane, so the walkthrough can unfold exactly what it points at.
import { compute, splitLines, type Segment } from '../../shared/diff.ts';
import { highlightFile, highlightLine, type HlState } from '../../shared/highlight.ts';
import type { DiffSettings, LineRange, Side, View } from '../../ir/types.ts';
import { esc, ICON, IR, T_ } from './env.ts';

export interface Half { n: number; html: string; raw: string; k?: 'add' | 'del' | 'ws' }
export interface Row {
  /** unified / plain */
  cls?: string;
  o?: number | null;
  n?: number | null;
  line?: number;
  mark?: string;
  html?: string;
  raw?: string;
  /** split */
  split?: boolean;
  l?: Half | null;
  r?: Half | null;
  eq: boolean;
}
export interface Model { key: string; file: string; view: View; split: boolean; plain: boolean; rows: Row[]; idx: Record<Side, Map<number, number>>; adds: number; dels: number }
export interface Fold { id: number; a: number; b: number; header?: string }
export type ViewRow = { fold: Fold; i?: undefined; unfolded?: undefined } | { i: number; unfolded?: number; fold?: undefined };
export interface CodeView { key: string; rows: ViewRow[]; idx: Record<Side, Map<number, number>>; html: string[]; cls: string[] }

const hlCache = new Map<string, { lines: string[]; html: string[] }>();
function hlLines(file: string, side: Side) {
  const key = file + '\0' + side;
  if (!hlCache.has(key)) {
    const f = IR.files[file];
    const t = f[side];
    const lines = t == null ? [] : splitLines(t);
    hlCache.set(key, { lines, html: highlightFile(lines, f.language) });
  }
  return hlCache.get(key)!;
}
function segHtml(segs: Segment[], lang: string | undefined, cls: string): string {
  let st: HlState = {}, out = '';
  for (const sg of segs) { const r = highlightLine(sg.text, lang, st); st = r.st; out += sg.changed && sg.text.trim() ? `<span class="${cls}">${r.html}</span>` : r.html; }
  return out;
}

const modelCache = new Map<string, Model>();
export function model(file: string, view: View, diff: DiffSettings): Model {
  const key = [file, view, diff.mode, diff.algorithm, diff.granularity, diff.whitespace].join('|');
  const hit = modelCache.get(key);
  if (hit) return hit;
  const f = IR.files[file];
  const lang = f.language;
  const m: Model = { key, file, view, split: false, plain: view !== 'diff', rows: [], idx: { before: new Map(), after: new Map() }, adds: 0, dels: 0 };
  if (view !== 'diff') {
    const side: Side = view === 'before' ? 'before' : 'after';
    const { html, lines } = hlLines(file, side);
    const marks: Record<number, string> = {};
    if (side === 'after' && f.before != null && f.after != null && f.status !== 'context') {
      const { rows } = compute(f.before, f.after, { algorithm: diff.algorithm, granularity: 'line' });
      let lastNew = 0;
      for (const r of rows) {
        if (r.type === 'add') { marks[r.new!] = 'ch-add'; m.adds++; }
        else if (r.type === 'mod' && !r.ws) { marks[r.new!] = 'ch-mod'; m.adds++; m.dels++; }
        else if (r.type === 'del') { m.dels++; const at = Math.max(1, lastNew); if (!/ch-delpt/.test(marks[at] || '')) marks[at] = ((marks[at] || '') + ' ch-delpt').trim(); }
        if (r.new) lastNew = r.new;
      }
    } else if (side === 'after' && f.status === 'added') { html.forEach((_, i) => (marks[i + 1] = 'ch-add')); m.adds = html.length; }
    else if (side === 'before' && f.status === 'deleted') m.dels = html.length;
    html.forEach((h, i) => { m.rows.push({ cls: marks[i + 1] || '', o: side === 'before' ? i + 1 : null, n: side === 'after' ? i + 1 : null, line: i + 1, html: h, raw: lines[i], eq: true }); m.idx[side].set(i + 1, i); });
  } else {
    const old = hlLines(file, 'before').html, neu = hlLines(file, 'after').html;
    const { rows } = compute(f.before, f.after, { algorithm: diff.algorithm, granularity: diff.granularity });
    const ws = diff.whitespace !== 'show';
    const push = (row: Row) => {
      const i = m.rows.length;
      m.rows.push(row);
      const o = row.split ? row.l?.n : row.o, n = row.split ? row.r?.n : row.n;
      if (o) m.idx.before.set(o, i);
      if (n) m.idx.after.set(n, i);
    };
    if (diff.mode === 'split') {
      m.split = true;
      const L: Half[] = [], R: Half[] = [];
      const flush = () => { for (let j = 0; j < Math.max(L.length, R.length); j++) push({ split: true, l: L[j] || null, r: R[j] || null, eq: false }); L.length = 0; R.length = 0; };
      for (const x of rows) {
        const o = x.old!, n = x.new!;
        if (x.type === 'eq') { flush(); push({ split: true, l: { n: o, html: old[o - 1], raw: x.oldText! }, r: { n, html: neu[n - 1], raw: x.newText! }, eq: true }); continue; }
        if (x.type === 'del') { m.dels++; L.push({ n: o, html: old[o - 1], k: 'del', raw: x.oldText! }); continue; }
        if (x.type === 'add') { m.adds++; R.push({ n, html: neu[n - 1], k: 'add', raw: x.newText! }); continue; }
        flush();
        if (x.ws && ws) { push({ split: true, l: { n: o, html: old[o - 1], k: 'ws', raw: x.oldText! }, r: { n, html: neu[n - 1], k: 'ws', raw: x.newText! }, eq: true }); continue; }
        m.adds++; m.dels++;
        push({ split: true, l: { n: o, html: x.segOld ? segHtml(x.segOld, lang, 'wd-del') : old[o - 1], k: 'del', raw: x.oldText! }, r: { n, html: x.segNew ? segHtml(x.segNew, lang, 'wd-add') : neu[n - 1], k: 'add', raw: x.newText! }, eq: false });
      }
      flush();
    } else {
      for (const r of rows) {
        const o = r.old!, n = r.new!;
        if (r.type === 'eq') push({ cls: '', o, n, mark: '', html: neu[n - 1], raw: r.newText, eq: true });
        else if (r.type === 'del') { m.dels++; push({ cls: 'del', o, n: null, mark: '−', html: old[o - 1], raw: r.oldText, eq: false }); }
        else if (r.type === 'add') { m.adds++; push({ cls: 'add', o: null, n, mark: '+', html: neu[n - 1], raw: r.newText, eq: false }); }
        else if (r.ws && ws) push({ cls: 'ws', o, n, mark: '', html: neu[n - 1], raw: r.newText, eq: true });
        else {
          m.adds++; m.dels++;
          push({ cls: 'del', o, n: null, mark: '−', html: r.segOld ? segHtml(r.segOld, lang, 'wd-del') : old[o - 1], raw: r.oldText, eq: false });
          push({ cls: 'add', o: null, n, mark: '+', html: r.segNew ? segHtml(r.segNew, lang, 'wd-add') : neu[n - 1], raw: r.newText, eq: false });
        }
      }
    }
  }
  modelCache.set(key, m);
  return m;
}

const rowSides = (r: Row): [number | null | undefined, number | null | undefined] => (r.split ? [r.l?.n, r.r?.n] : [r.o, r.n]);

/** Foldable runs of unchanged rows, GitHub-style: `ctx` rows stay around every change. */
const foldCache = new Map<string, Fold[]>();
export function foldsOf(m: Model, ctx: number | null): Fold[] {
  if (m.plain || typeof ctx !== 'number') return [];
  const key = m.key + '#' + ctx;
  const hit = foldCache.get(key);
  if (hit) return hit;
  const n = m.rows.length;
  const keep = new Array<boolean>(n).fill(false);
  let any = false;
  m.rows.forEach((r, i) => { if (!r.eq) { any = true; for (let j = Math.max(0, i - ctx); j <= Math.min(n - 1, i + ctx); j++) keep[j] = true; } });
  const folds: Fold[] = [];
  if (any) {
    for (let i = 0; i < n;) {
      if (keep[i]) { i++; continue; }
      let j = i; while (j < n && !keep[j]) j++;
      if (j - i >= 4) folds.push({ id: folds.length, a: i, b: j - 1 });
      i = j;
    }
    // GitHub-style hunk header for the hunk that follows each fold
    folds.forEach((f, k) => {
      const end = k + 1 < folds.length ? folds[k + 1].a - 1 : n - 1;
      if (f.b >= n - 1) { f.header = ''; return; }
      let os: number | null = null, ol = 0, ns: number | null = null, nl = 0;
      for (let i = f.b + 1; i <= end; i++) {
        const [o, nn] = rowSides(m.rows[i]);
        if (o) { if (os == null) os = o; ol++; }
        if (nn) { if (ns == null) ns = nn; nl++; }
      }
      f.header = `@@ -${os || 0},${ol} +${ns || 0},${nl} @@`;
    });
  }
  foldCache.set(key, folds);
  return folds;
}

function rowHtml(m: Model, vr: ViewRow): string {
  if (vr.fold) {
    const f = vr.fold;
    return `<span class="fold-gut">${ICON.unfold}</span><span class="txt">${f.header ? `<span class="hunk">${esc(f.header)}</span>` : ''}<span class="fold-n">${f.b - f.a + 1} ${T_('줄 숨김', 'hidden lines')}</span></span>`;
  }
  const r = m.rows[vr.i];
  if (r.split) {
    const half = (h: Half | null | undefined) => (h ? `<div class="half ${h.k || ''}"><span class="gn">${h.n}</span><span class="mk">${h.k === 'add' ? '+' : h.k === 'del' ? '−' : ''}</span><span class="txt">${h.html || ''}</span></div>` : '<div class="half empty"></div>');
    return half(r.l) + half(r.r);
  }
  if (m.plain) return `<span class="gn">${r.line}</span><span class="cg"></span><span class="txt">${r.html || ''}</span>`;
  return `<span class="gn o">${r.o || ''}</span><span class="gn n">${r.n || ''}</span><span class="mk">${r.mark || ''}</span><span class="txt">${r.html || ''}</span>`;
}
/** The base class of a view row (decorations are added on top). */
export function rowClass(m: Model, vr: ViewRow): string {
  if (vr.fold) return 'row fold';
  const r = m.rows[vr.i];
  const extra = vr.unfolded != null ? ' unfold' : '';
  if (r.split) return 'row split' + extra;
  if (m.plain) return `row plain ${r.cls}${extra}`;
  return `row ${r.cls}${extra}`;
}

/** The rows a pane shows: model rows with collapsed folds (cached per expansion state). */
const viewCache = new Map<string, CodeView>();
export function viewOf(m: Model, folds: Fold[], expanded: Set<number>): CodeView {
  const key = m.key + '#' + folds.length + '#' + [...expanded].filter((id) => id < folds.length).sort((a, b) => a - b).join(',');
  const hit = viewCache.get(key);
  if (hit) return hit;
  const rows: ViewRow[] = [], idx: Record<Side, Map<number, number>> = { before: new Map(), after: new Map() };
  const mapRow = (i: number, at: number) => {
    const [o, n] = rowSides(m.rows[i]);
    if (o) idx.before.set(o, at);
    if (n) idx.after.set(n, at);
  };
  let f = 0;
  for (let i = 0; i < m.rows.length;) {
    const fold = folds[f];
    if (fold && i === fold.a) {
      f++;
      if (!expanded.has(fold.id)) {
        const at = rows.length;
        rows.push({ fold });
        for (let j = fold.a; j <= fold.b; j++) mapRow(j, at);
      } else for (let j = fold.a; j <= fold.b; j++) { mapRow(j, rows.length); rows.push({ i: j, unfolded: fold.id }); }
      i = fold.b + 1;
      continue;
    }
    mapRow(i, rows.length);
    rows.push({ i });
    i++;
  }
  const v: CodeView = { key, rows, idx, html: rows.map((vr) => rowHtml(m, vr)), cls: rows.map((vr) => rowClass(m, vr)) };
  viewCache.set(key, v);
  return v;
}

/** Model-row span of a line range (for unfolding). */
export function modelRowsOf(m: Model, r: { side: Side; from: number; to: number }): [number, number] | null {
  const map = m.idx[r.side]; let lo = Infinity, hi = -1;
  for (let ln = r.from; ln <= r.to; ln++) { const i = map.get(ln); if (i != null) { lo = Math.min(lo, i); hi = Math.max(hi, i); } }
  return hi < 0 ? null : [lo, hi];
}
/** Contiguous view-row span of a line range, so interleaved rows of the other side stay inside. */
export function rangeRows(v: CodeView, r: LineRange): number[] {
  const map = v.idx[r.side]; let lo = Infinity, hi = -1;
  for (let ln = r.from; ln <= r.to; ln++) { const i = map.get(ln); if (i != null) { lo = Math.min(lo, i); hi = Math.max(hi, i); } }
  return hi < 0 ? [] : Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
}
