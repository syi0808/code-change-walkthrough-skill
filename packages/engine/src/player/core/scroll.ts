// Where an editor scrolls to: a target range placed by mode (center / top / ensure
// visible / follow the line being written), interpolated from the previous target.
import { clamp } from './env.ts';
import type { CodeView } from './model.ts';
import type { Scroll, ScrollTarget } from './state.ts';

export interface ScrollEnv { view: CodeView; row: (vi: number) => HTMLElement | undefined; height: number; contentHeight: number }

function rowRange(v: CodeView, a: ScrollTarget): [number, number] | null {
  const map = v.idx[a.side] || v.idx.after;
  const i0 = map.get(a.line != null ? a.line : a.from!);
  const i1 = map.get(a.to != null ? a.to : a.line!);
  if (i0 == null) return null;
  return [i0, i1 == null ? i0 : i1];
}
/** Height of an explanation attached under a row (it scrolls into view with its line). */
function noteBelow(e: HTMLElement): number {
  const n = e.nextElementSibling as HTMLElement | null;
  return n && n.classList.contains('note') ? n.offsetHeight + 8 : 0;
}
function targetPx(E: ScrollEnv, scroll: Scroll, fromPx: number | null): number | null {
  const rr = rowRange(E.view, scroll.to);
  if (!rr) return fromPx;
  const e0 = E.row(rr[0]), e1 = E.row(rr[1]) || e0;
  if (!e0 || !e1) return fromPx;
  const top = e0.offsetTop, bottom = e1.offsetTop + e1.offsetHeight + noteBelow(e1);
  const H = E.height, rh = e0.offsetHeight || 20;
  const max = Math.max(0, E.contentHeight - H);
  let y: number;
  if (scroll.mode === 'top') y = top - rh * 3;
  else if (scroll.mode === 'ensure' && fromPx != null && top >= fromPx + rh * 2 && bottom <= fromPx + H - rh * 2) y = fromPx;
  else if (scroll.mode === 'follow' && fromPx != null) y = bottom > fromPx + H * 0.7 ? bottom - H * 0.7 : top < fromPx + rh ? top - rh * 2 : fromPx;
  else y = bottom - top > H - rh * 4 ? top - rh * 2 : Math.min((top + bottom) / 2 - H * 0.45, top - rh * 2);
  return clamp(y, 0, max);
}
export function scrollPx(E: ScrollEnv, scroll: Scroll): number | null {
  const prevPx = scroll.prev ? scrollPx(E, { ...scroll.prev, p: 1 }) : null;
  const to = targetPx(E, scroll, prevPx);
  if (to == null) return prevPx;
  if (scroll.p >= 1 || prevPx == null) return to;
  return prevPx + (to - prevPx) * scroll.p;
}
