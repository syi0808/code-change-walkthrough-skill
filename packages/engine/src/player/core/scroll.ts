// Where an editor scrolls to: a target range placed by mode (center / top / ensure
// visible / follow the line being written), interpolated from the previous target.
import { clamp } from './env.ts';
import type { Head } from './decorate.ts';
import type { CodeView } from './model.ts';
import type { Scroll, ScrollTarget } from './state.ts';

export interface ScrollEnv {
  view: CodeView; row: (vi: number) => HTMLElement | undefined; height: number; contentHeight: number;
  /** The row being written (see decorate): "follow" tracks the write edge. */
  head?: Head | null;
  /** Height of one full row. */
  rowH?: number;
}

function rowRange(v: CodeView, a: ScrollTarget): [number, number] | null {
  const map = v.idx[a.side] || v.idx.after;
  const i0 = map.get(a.line != null ? a.line : a.from!);
  const i1 = map.get(a.to != null ? a.to : a.line!);
  if (i0 == null) return null;
  return [i0, i1 == null ? i0 : i1];
}
/** How far an explanation attached to a row reaches below it (it scrolls into view with its line). */
function noteBelow(e: HTMLElement): number {
  const n = e.nextElementSibling as HTMLElement | null;
  if (!n || !n.classList.contains('note')) return 0;
  return Math.max(0, n.offsetTop + n.offsetHeight - (e.offsetTop + e.offsetHeight)) + 8;
}
/** Where the write head sits once the page carries it, and the stretch over which the page takes it over. */
const HOLD = 0.62, EASE_IN = 0.16;

function targetPx(E: ScrollEnv, scroll: Scroll, fromPx: number | null): number | null {
  const H = E.height;
  let top: number, bottom: number, rh: number;
  const edge = scroll.mode === 'follow' ? writeEdge(E) : null;
  if (edge != null) { rh = E.rowH || 20; bottom = edge; top = edge - rh; }
  else {
    const rr = rowRange(E.view, scroll.to);
    if (!rr) return fromPx;
    const e0 = E.row(rr[0]), e1 = E.row(rr[1]) || e0;
    if (!e0 || !e1) return fromPx;
    top = e0.offsetTop; bottom = e1.offsetTop + e1.offsetHeight + noteBelow(e1); rh = e0.offsetHeight || E.rowH || 20;
  }
  const max = Math.max(0, E.contentHeight - H);
  let y: number;
  if (scroll.mode === 'top') y = top - rh * 3;
  else if (scroll.mode === 'ensure' && fromPx != null) {
    // the least movement that keeps the range (and its explanation) in view with two rows of margin.
    // Continuous in the range's size: an explanation growing under the line pushes the page
    // gradually instead of flipping the target to "centre" at a threshold.
    y = Math.max(bottom + rh * 2 - H, Math.min(fromPx, top - rh * 2));
    if (bottom - top > H - rh * 4) y = top - rh * 2;
  }
  else if (scroll.mode === 'follow' && fromPx != null) {
    // The head travels down the screen until it nears the hold line; from there the page
    // takes over, picking up speed smoothly (no jump), and the head stays put while the page
    // carries the new lines up. One thing moves at a time, at one speed.
    const over = bottom - (fromPx + H * (HOLD - EASE_IN));
    const b = H * EASE_IN * 2;
    y = top < fromPx + rh ? top - rh * 2 : over <= 0 ? fromPx : over < b ? fromPx + (over * over) / (2 * b) : fromPx + over - b / 2;
  }
  else y = bottom - top > H - rh * 4 ? top - rh * 2 : Math.min((top + bottom) / 2 - H * 0.45, top - rh * 2);
  return clamp(y, 0, max);
}
/**
 * The bottom of what has been written, in px. It moves continuously: from the last row
 * written to the bottom of the row being written, so rows already on screen in between
 * (removed lines, context) are passed over smoothly instead of in one jump.
 */
function writeEdge(E: ScrollEnv): number | null {
  const h = E.head;
  const cur = h ? E.row(h.vi) : undefined;
  if (!h || !cur) return null;
  const pe = h.prev != null ? E.row(h.prev) : undefined;
  const from = pe ? pe.offsetTop + pe.offsetHeight : cur.offsetTop;
  const to = cur.offsetTop + (E.rowH || 20);
  return from + (to - from) * clamp(h.g, 0, 1);
}

/** Beyond this distance (in viewport heights) a scroll is too fast to follow: it is shortened. */
const FAR = 1.25;
/** A shortened scroll glides this far (in viewport heights) into its target. */
const GLIDE = 0.8;
/** Share of the move spent dimming before the cut. */
const CUT = 0.2;

export interface ScrollFrame { y: number | null; dim: number }

/**
 * The scroll for this frame, starting from `from` (where the editor really is when the move
 * began; null: as computed). A move of more than about a screen cannot be followed by the eye at
 * any speed that fits a step, and a blur of passing code reads as a teleport. Such a move dims the
 * code, cuts to just short of the target while dimmed, and glides the rest: the eye sees the
 * direction and the arrival, and the cut falls in the dip (like a blink).
 */
export function scrollFrame(E: ScrollEnv, scroll: Scroll, from: number | null): ScrollFrame {
  const P: ScrollEnv = { ...E, head: null };
  const prevPx = scroll.prev ? scrollPx(P, { ...scroll.prev, p: 1 }) : null;
  // "keep in view" is judged from where the editor really is, so a range already on screen stays put
  const to = scrollPx(E, { ...scroll, p: 1 }, scroll.mode === 'ensure' ? from : null);
  const start = from ?? prevPx;
  if (to == null) return { y: start, dim: 0 };
  if (scroll.p >= 1 || start == null) return { y: to, dim: 0 };
  const d = to - start, H = E.height;
  if (Math.abs(d) <= H * FAR) return { y: start + d * scroll.p, dim: 0 };
  if (scroll.p < CUT) return { y: start, dim: scroll.p / CUT };
  const q = (scroll.p - CUT) / (1 - CUT);
  const entry = to - Math.sign(d) * H * GLIDE;
  return { y: entry + (to - entry) * q, dim: clamp(1 - q / 0.3, 0, 1) };
}

export function scrollPx(E: ScrollEnv, scroll: Scroll, fromOverride: number | null = null): number | null {
  // earlier targets are evaluated as they ended: the write head belongs to this one only
  const P: ScrollEnv = { ...E, head: null };
  const prevPx = scroll.prev ? scrollPx(P, { ...scroll.prev, p: 1 }) : null;
  // Consecutive follows (hunk after hunk) share one base, the scroll before the first of
  // them, so the page keeps carrying the head across hunks instead of settling in again.
  let base = prevPx;
  if (scroll.mode === 'follow') {
    let b = scroll.prev;
    while (b && b.mode === 'follow') b = b.prev;
    if (b && b !== scroll.prev) base = scrollPx(P, { ...b, p: 1 });
  }
  const to = targetPx(E, scroll, scroll.mode === 'follow' ? base : fromOverride ?? prevPx);
  if (to == null) return prevPx;
  if (scroll.p >= 1 || prevPx == null) return to;
  return prevPx + (to - prevPx) * scroll.p;
}
