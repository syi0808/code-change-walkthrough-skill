// Folder paths in the explorer, shared by the compiler (to time a file pick) and the player
// (to animate it). A row is a "compact" folder as VS Code shows it: a folder with no files
// and a single subfolder is merged with that subfolder ("src/app/api"), so one row, one click.
//
// Picking a file the way a person does it with the mouse: close the old file's branch where it
// parts from the new one (one click on its outermost folder folds everything under it), then
// open the new file's folders (outermost first), one at a time, then select the file.
import { EX_ROW, FOLD_STEP, FOLD_CLICK, FOLD_TRAVEL, WALK_FILE, moveMs } from './timing.ts';

export interface DirIndex { files: Map<string, number>; names: Map<string, string[]>; subs: Map<string, Set<string>>; partial: Set<string> }

export function dirIndex(paths: Iterable<string>, partial: Iterable<string> = []): DirIndex {
  const files = new Map<string, number>();
  const names = new Map<string, string[]>();
  const subs = new Map<string, Set<string>>();
  const sub = (d: string) => { let x = subs.get(d); if (!x) subs.set(d, (x = new Set())); return x; };
  for (const p of paths) {
    const parts = p.split('/');
    const dir = parts.slice(0, -1).join('/');
    files.set(dir, (files.get(dir) || 0) + 1);
    let n = names.get(dir); if (!n) names.set(dir, (n = [])); n.push(parts[parts.length - 1]);
    for (let i = 1; i < parts.length; i++) sub(parts.slice(0, i - 1).join('/')).add(parts.slice(0, i).join('/'));
  }
  const part = new Set(partial);
  // a pruned folder is still a row of its parent
  for (const d of part) { const parts = d.split('/'); for (let i = 1; i <= parts.length; i++) sub(parts.slice(0, i - 1).join('/')).add(parts.slice(0, i).join('/')); }
  return { files, names, subs, partial: part };
}

/** Compact folder rows from the root down to a file's folder (the row keys the explorer expands). */
export function chain(ix: DirIndex, file: string | null | undefined): string[] {
  if (!file) return [];
  const parts = file.split('/');
  const out: string[] = [];
  let leaf = '';
  for (let i = 1; i < parts.length; i++) {
    const d = parts.slice(0, i).join('/');
    leaf = d;
    // merged into the next row while this folder has no files, one subfolder, and is not partial
    const merged = i < parts.length - 1 && !(ix.files.get(d) || 0) && (ix.subs.get(d)?.size || 0) === 1 && !ix.partial.has(d);
    if (!merged) out.push(leaf);
  }
  return out;
}

export interface FoldMove { kind: 'close' | 'open' | 'file'; path: string }

/** The moves from showing `from` to showing `to`: the close (if the branches part), opens, then the file itself.
 *  `keep`: nothing closes (a drag opens the folders it hovers, and leaves the others as they are). */
export function foldMoves(ix: DirIndex, from: string | null | undefined, to: string, keep = false): FoldMove[] {
  const a = chain(ix, from), b = chain(ix, to);
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  if (keep) { const had = new Set(a); return [...b.filter((d) => !had.has(d)).map((path): FoldMove => ({ kind: 'open', path })), { kind: 'file', path: to }]; }
  return [
    ...(k < a.length ? [{ kind: 'close', path: a[k] } as FoldMove] : []),
    ...b.slice(k).map((path): FoldMove => ({ kind: 'open', path })),
    { kind: 'file', path: to },
  ];
}

const EX_LAND = 200;
const byName = (x: string, y: string) => x.localeCompare(y, undefined, { sensitivity: 'base' });
const last = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** The explorer's rows (paths) for a set of open folders, in order (folders first, by name; compact folders as one row). */
export function rowsOf(ix: DirIndex, open: Set<string>): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const d of [...(ix.subs.get(dir) || [])].sort((x, y) => byName(last(x), last(y)))) {
      let leaf = d;
      while (!(ix.files.get(leaf) || 0) && (ix.subs.get(leaf)?.size || 0) === 1 && !ix.partial.has(leaf)) leaf = [...ix.subs.get(leaf)!][0];
      out.push(leaf);
      if (open.has(leaf)) walk(leaf);
    }
    for (const f of [...(ix.names.get(dir) || [])].sort(byName)) out.push(dir ? `${dir}/${f}` : f);
    if (dir && ix.partial.has(dir)) out.push(`${dir}/…`);
  };
  walk('');
  return out;
}

/** One move of the walk: how long it takes, and the share of it spent travelling to the row and pressing. */
export interface WalkSeg { ms: number; travel: number; click: number }

const plans = new WeakMap<DirIndex, Map<string, WalkSeg[]>>();

/**
 * The walk's timing, from how far each move goes (not a fixed time per move): the pointer, and the
 * list scrolling with it, travel as many rows as lie between one row and the next, at a speed the
 * eye can follow (see moveMs). A folder opening or closing is the exception: a fixed time.
 * The last segment brings the file's row into view.
 */
export function walkPlan(ix: DirIndex, from: string | null | undefined, to: string, keep = false): WalkSeg[] {
  let memo = plans.get(ix); if (!memo) plans.set(ix, (memo = new Map()));
  const key = `${from || ''}\n${to}\n${keep ? 1 : 0}`;
  const hit = memo.get(key); if (hit) return hit;
  const moves = foldMoves(ix, from, to, keep);
  const open = new Set(chain(ix, from));
  let rows = rowsOf(ix, open);
  // a placeholder in a folder (inFolder) stands for the folder's row
  const rowOf = (rs: string[], p: string) => { const i = rs.indexOf(p); if (i >= 0 || !p.endsWith('\u0001')) return i; const c = chain(ix, p); return c.length ? rs.indexOf(c[c.length - 1]) : -1; };
  let prevRow = from ? rowOf(rows, from) : -1;
  const out: WalkSeg[] = [];
  for (const mv of moves) {
    const i = rowOf(rows, mv.path);
    const dist = prevRow < 0 || i < 0 ? 0 : Math.abs(i - prevRow);
    // a row off screen is brought a quarter of the list in, past the rows between (EX_LAND)
    const px = dist * EX_ROW + (dist * EX_ROW > EX_LAND ? EX_LAND : 0);
    const travel = moveMs(px, mv.kind === 'file' ? WALK_FILE : FOLD_STEP * FOLD_TRAVEL, Infinity);
    if (mv.kind === 'file') { out.push({ ms: travel, travel: 1, click: 1 }); break; }
    if (mv.kind === 'close') open.delete(mv.path); else open.add(mv.path);
    const next = rowsOf(ix, open);
    const click = FOLD_STEP * (FOLD_CLICK - FOLD_TRAVEL);
    // a folder opens or closes in a fixed time, however many rows it shows or hides: the rows
    // unfold as one object (a list growing), not as content travelling past the eye
    const toggle = FOLD_STEP * (1 - FOLD_CLICK);
    const ms = travel + click + toggle;
    out.push({ ms, travel: travel / ms, click: (travel + click) / ms });
    rows = next; prevRow = rowOf(rows, mv.path);
  }
  memo.set(key, out);
  return out;
}

/** A walk's time (ms). */
export const walkTotal = (ix: DirIndex, from: string | null | undefined, to: string, keep = false): number =>
  Math.round(walkPlan(ix, from, to, keep).reduce((a, x) => a + x.ms, 0));
/** The row a file is created from: a folder that exists, as a path the walk can aim at (a placeholder file in it). */
export const inFolder = (dir: string): string => (dir ? `${dir}/\u0001` : '\u0001');
/** Every path the explorer may show: the tree at head, the walkthrough's files, and renamed files' old paths. */
export function treePaths(tree: { files: [number, string][]; dirs: string[] } | undefined, files: Record<string, { oldPath?: string }>): string[] {
  return [
    ...(tree ? tree.files.map(([d, n]) => (tree.dirs[d] ? `${tree.dirs[d]}/${n}` : n)) : []),
    ...Object.keys(files),
    ...Object.values(files).map((f) => f.oldPath).filter((p): p is string => !!p),
  ];
}

