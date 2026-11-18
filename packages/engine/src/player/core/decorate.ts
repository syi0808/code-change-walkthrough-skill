// Row decorations for one pane at one moment: highlights (with the attention budget),
// focus dimming, the diff reveal, and edit replay (typed, line by line, or as a block).
// Pure: everything here follows from the frame, so it moves with the timeline clock.
import { clamp, easeOut } from './env.ts';
import { rangeRows, type CodeView, type Model } from './model.ts';
import type { PaneState, State } from './state.ts';

export interface Head { vi: number; prev: number | null; g: number }

export interface Decorations {
  /** extra classes per view row */
  cls: string[];
  /** inline style per view row (row growth, flash fade) */
  style: (string | undefined)[];
  /** highlight labels by view row */
  labels: Map<number, { text: string; tone: string }>;
  /** rows being typed: where the caret is */
  caret: { vi: number; offset: number; half: 0 | 1 }[];
  /** The write head: the row being written now (vi), the last row written before it, and how far
   *  the head has come from that row to this one (0..1). The editor follows it (scroll mode "follow"). */
  head: Head | null;
}

/** A row that appears pushes the rows below smoothly: it grows from zero height. */
const GROW_CHARS = 4;
/** How many line beats a just-written line stays marked as new (its added colour settles back). */
const FRESH_BEATS = 5;
/** A block waits this share of its time while the editor brings its place into view. */
const BLOCK_LEAD = 0.3;

export function decorate(ps: PaneState, s: State, m: Model, v: CodeView): Decorations {
  const n = v.rows.length;
  const cls = new Array<string>(n).fill('');
  const style = new Array<string | undefined>(n).fill(undefined);
  const add = (i: number, c: string) => { cls[i] = cls[i] ? cls[i] + ' ' + c : c; };
  const labels = new Map<number, { text: string; tone: string }>();
  const caret: Decorations['caret'] = [];
  let head: Head | null = null;

  // attention budget: only the two most recent highlights are fully salient
  const own = (k: string | number) => !String(k).startsWith('g');
  const fresh = new Set(ps.hl.filter((h) => own(h.key)).slice(-2).map((h) => h.key));
  for (const h of ps.hl) {
    const rs = rangeRows(v, h);
    if (!rs.length || h.p <= 0) continue;
    const old = !fresh.has(h.key) && own(h.key);
    const shown = Math.max(1, Math.ceil(rs.length * h.p));
    rs.slice(0, shown).forEach((i, k) => { add(i, old ? 'hl hl-old' : `hl hl-${h.tone}`); if (k === 0) add(i, 'hl-first'); if (k === shown - 1) add(i, 'hl-last'); });
    if (h.label && !old) labels.set(rs[0], { text: h.label, tone: h.tone });
  }
  if (ps.focus) {
    const keep = new Set(rangeRows(v, ps.focus));
    for (const h of ps.hl) for (const i of rangeRows(v, h)) keep.add(i);
    if (keep.size) for (let i = 0; i < n; i++) if (!keep.has(i)) add(i, 'dim');
  }
  if (ps.flash && ps.flash.p < 1) for (const i of rangeRows(v, ps.flash)) { add(i, 'flash'); style[i] = `--fo:${(1 - ps.flash.p).toFixed(3)}`; }
  if (s.reveal && s.reveal.file === ps.file && s.reveal.p < 1) {
    const changed: number[] = [];
    v.rows.forEach((vr, vi) => { if (vr.fold) return; const r = m.rows[vr.i]; if (m.plain ? /ch-/.test(r.cls || '') : !r.eq) changed.push(vi); });
    const shown = Math.floor(changed.length * s.reveal.p);
    for (let k = shown; k < changed.length; k++) add(changed[k], 'chg-pend');
  }

  // A new line opens its slot top-down and is uncovered by it (no fade, no sideways motion):
  // the edge moves at one constant speed, so the eye can ride it or the page can carry it.
  const grow = (vi: number, g: number, curve = easeOut) => { if (g < 1) { add(vi, 'grow'); style[vi] = `--g:${curve(g).toFixed(3)}`; } };
  const linear = (x: number) => x;
  // a just-written line is marked by a brighter added colour that settles over a few beats
  const markNew = (vi: number, fr: number) => { if (fr > 0.01) { add(vi, 'ln-fresh'); style[vi] = (style[vi] ? style[vi] + ';' : '') + `--fr:${Math.min(1, fr).toFixed(3)}`; } };
  for (const t of s.typing) {
    if (t.file !== ps.file || t.p >= 1) continue;
    const items: { vi: number; del?: boolean; add?: string | null; onlyAdd?: boolean }[] = [];
    for (const vi of rangeRows(v, t)) {
      const vr = v.rows[vi]; if (vr.fold) continue;
      const r = m.rows[vr.i];
      if (m.plain) items.push({ vi, add: r.raw || '', onlyAdd: true });
      else if (r.split) items.push({ vi, del: r.l?.k === 'del', add: r.r?.k === 'add' ? r.r.raw || '' : null, onlyAdd: r.l?.k !== 'del' });
      else if (r.cls === 'del') items.push({ vi, del: true });
      else if (r.cls === 'add') items.push({ vi, add: r.raw || '', onlyAdd: true });
    }
    const dels = items.filter((x) => x.del);
    const adds = items.filter((x) => x.add != null);
    const dp = dels.length ? (t.dp != null ? t.dp : 0.28) : 0;
    const delP = dels.length ? clamp(t.p / Math.max(0.01, dp), 0, 1) : 1;
    const typeP = dels.length ? clamp((t.p - dp) / Math.max(0.01, 1 - dp), 0, 1) : t.p;
    dels.forEach((x, k) => { if (t.p <= 0 || delP * dels.length <= k) add(x.vi, 'typ-del-pend'); });
    // a row not written yet takes no space (unified) or keeps an empty slot (split)
    const pend = (x: { vi: number; onlyAdd?: boolean }) => add(x.vi, x.onlyAdd && !m.split ? 'typ-hidden' : 'typ-add-pend');
    if (t.mode === 'lines' || t.mode === 'block') {
      // lines: one line per beat at a constant cadence. block: the same wipe, run fast and
      // landing softly, so the block opens as one gap instead of every row growing at once.
      const pos = t.mode === 'block' ? easeOut(clamp((typeP - BLOCK_LEAD) / 0.5, 0, 1)) * adds.length : typeP * adds.length;
      adds.forEach((x, idx) => {
        if (t.p <= 0 || typeP <= 0 || idx >= pos || pos <= 0) { pend(x); return; }
        if (!m.split && x.onlyAdd) grow(x.vi, clamp(pos - idx, 0, 1), linear);
        if (pos - idx < 1) head = { vi: x.vi, prev: idx ? adds[idx - 1].vi : null, g: pos - idx };
        // settles by the end of the replay, so nothing changes when the replay hands over
        const tail = clamp((1 - t.p) / 0.12, 0, 1);
        markNew(x.vi, tail * (t.mode === 'block' ? 1 - clamp((typeP - BLOCK_LEAD - 0.5) / (0.5 - BLOCK_LEAD), 0, 1) : 1 - Math.max(0, pos - idx - 1) / FRESH_BEATS));
      });
      if (!head && adds.length && typeP > 0 && typeP < 1) { const k = Math.min(adds.length - 1, Math.floor(pos)); head = { vi: adds[k].vi, prev: k ? adds[k - 1].vi : null, g: 0 }; }
      continue;
    }
    const len = (x: { add?: string | null }) => (x.add || '').replace(/^\s+/, '').length;
    let budget = typeP * (adds.reduce((a, x) => a + len(x), 0) || 1);
    let before: number | null = null;
    for (const x of adds) {
      const L = len(x);
      if (t.p <= 0 || budget <= 0) { pend(x); continue; }
      if (budget >= L) { budget -= L; before = x.vi; continue; }
      add(x.vi, 'typ-cur');
      head = { vi: x.vi, prev: before, g: clamp(budget / GROW_CHARS, 0, 1) };
      if (!m.split && x.onlyAdd) grow(x.vi, clamp(budget / GROW_CHARS, 0, 1));
      caret.push({ vi: x.vi, offset: (x.add || '').length - L + Math.floor(budget), half: m.split ? 1 : 0 });
      budget = 0;
    }
  }
  return { cls, style, labels, caret, head };
}

/** Line ranges the walkthrough points at in this pane: folds around them open. */
export function pointedRanges(ps: PaneState, s: State): { side: 'before' | 'after'; from: number; to: number }[] {
  const refs: { side: 'before' | 'after'; from: number; to: number }[] = [...ps.hl];
  if (ps.focus) refs.push(ps.focus);
  for (const n of ps.notes) refs.push({ side: n.side, from: n.line, to: n.line });
  if (ps.flash) refs.push(ps.flash);
  if (ps.tokline) refs.push({ side: ps.tokline.side, from: ps.tokline.line, to: ps.tokline.line });
  const to = ps.scroll?.to;
  if (to && ps.scroll!.mode !== 'top') refs.push({ side: to.side, from: to.from ?? to.line ?? 1, to: to.to ?? to.line ?? 1 });
  for (const t of s.typing) if (t.file === ps.file) refs.push(t);
  return refs;
}
