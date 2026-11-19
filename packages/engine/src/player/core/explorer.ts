// Where the explorer is scrolled, as part of the state: a pure function of timeline time.
// Rows are a fixed height and which folders are open is itself a function of time, so the
// row a file sits on, and the scroll that keeps it in view, are computed, never measured.
// The scroll moves as little as it can (a row already comfortably in view leaves it put), so
// it depends on where it was; that history is the state's own (scene snapshots carry it), not
// the screen's, so a frame looks the same however it was reached.
import { glide, walkAt } from '../../shared/timing.ts';
import { chain, foldMoves, walkPlan } from '../../shared/tree-path.ts';
import { dirs, rowsAt } from './tree.ts';

export const ROW_H = 22;
/** Space under the last row (the list's bottom padding). */
const PAD = 16;
const view = { h: 0, filter: false };

/** The explorer's viewport height and filter. Returns true when they changed (the state must be recomputed). */
export function setExplorerView(h: number, filter: boolean): boolean {
  if (h <= 0) h = view.h; // hidden panel: keep the last size
  if (h === view.h && filter === view.filter) return false;
  view.h = h; view.filter = filter;
  return true;
}
export const explorerFilter = (): boolean => view.filter;

/** The least scroll that keeps row y comfortably in view: entering from an edge, it lands a quarter of the height in. */
function keep(top: number, y: number, count: number): number {
  const H = view.h;
  const max = Math.max(0, count * ROW_H + PAD - H);
  if (y >= top + 24 && y + ROW_H <= top + H - 24) return Math.min(top, max);
  const m = H * 0.25;
  const t = y < top + 24 ? y - m : y + ROW_H - H + m;
  return Math.max(0, Math.min(t, max));
}

function rowTop(open: Set<string>, path: string, T: number, focus: string | null): { y: number | null; count: number } {
  const rows = rowsAt(open, view.filter, T, focus);
  let i = rows.findIndex((r) => r.path === path);
  // a placeholder in a folder (inFolder) stands for the folder's row
  if (i < 0 && path.endsWith('\u0001')) { const leaf = chain(dirs, path).pop(); if (leaf) i = rows.findIndex((r) => r.path === leaf); }
  return { y: i < 0 ? null : i * ROW_H, count: rows.length };
}

/** At rest: the file in view (or being picked) is kept in view. */
export function settleTop(top: number, target: string | null, T: number, focus: string | null): number {
  if (!view.h || !target) return top;
  const r = rowTop(new Set(chain(dirs, target)), target, T, focus);
  return r.y == null ? top : keep(top, r.y, r.count);
}

/**
 * During a walk from `from` to `file` at progress p: each folder's row comes into view while the
 * pointer heads for it, then the file's row (see walkAt). `top` is where the explorer rested before.
 */
export function walkTop(top: number, from: string | null, file: string, p: number, T: number, keepOpen = false): number {
  if (!view.h) return top;
  const moves = foldMoves(dirs, from, file, keepOpen);
  const folds = moves.length - 1;
  const { k, local, seg } = walkAt(walkPlan(dirs, from, file, keepOpen), p);
  const open = new Set(chain(dirs, from));
  for (let j = 0; j <= k; j++) {
    const mv = moves[j];
    const r = rowTop(open, mv.path, T, file);
    const to = r.y == null ? top : keep(top, r.y, r.count);
    if (j === k) return top + (to - top) * glide(j < folds ? Math.min(1, local / seg.travel) : local);
    top = to;
    if (mv.kind === 'close') open.delete(mv.path); else if (mv.kind === 'open') open.add(mv.path);
  }
  return top;
}
