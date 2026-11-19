// The explorer's file tree (VS Code-like): the repository at head plus every embedded file.
import { dirIndex, treePaths } from '../../shared/tree-path.ts';
import { IR } from './env.ts';
import { fileBorn, rowFrom, rowUntil } from './timeline.ts';

export interface DirNode { name: string; path: string; dirs: Map<string, DirNode>; dirList: DirNode[]; files: { name: string; path: string }[]; changed: number; partial: boolean }
export const changedStatus = (p: string): string | null => { const f = IR.files[p]; return f && f.status !== 'context' ? f.status || null : null; };

export function ancestors(p: string): string[] {
  const parts = p.split('/');
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'));
  return out;
}

export const treeRoot: DirNode = (() => {
  const root: DirNode = { name: '', path: '', dirs: new Map(), dirList: [], files: [], changed: 0, partial: false };
  const ensureDir = (dpath: string): DirNode => {
    let node = root, acc = '';
    if (!dpath) return root;
    for (const part of dpath.split('/')) {
      acc = acc ? acc + '/' + part : part;
      if (!node.dirs.has(part)) node.dirs.set(part, { name: part, path: acc, dirs: new Map(), dirList: [], files: [], changed: 0, partial: false });
      node = node.dirs.get(part)!;
    }
    return node;
  };
  const seen = new Set<string>();
  const addFile = (p: string) => {
    if (seen.has(p)) return; seen.add(p);
    const i = p.lastIndexOf('/');
    ensureDir(i < 0 ? '' : p.slice(0, i)).files.push({ name: p.slice(i + 1), path: p });
  };
  if (IR.tree) {
    for (const [d, name] of IR.tree.files) { const dir = IR.tree.dirs[d]; addFile(dir ? dir + '/' + name : name); }
    for (const d of IR.tree.partial || []) ensureDir(d).partial = true;
  }
  for (const p of Object.keys(IR.files)) addFile(p);
  // a renamed file sits at its old path until the walkthrough moves it (see fsOp)
  for (const f of Object.values(IR.files)) if (f.oldPath) addFile(f.oldPath);
  const cmp = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const sortTree = (n: DirNode): number => {
    n.dirList = [...n.dirs.values()].sort(cmp);
    n.files.sort(cmp);
    n.changed = n.files.filter((f) => changedStatus(f.path)).length;
    for (const c of n.dirList) n.changed += sortTree(c);
    return n.changed;
  };
  sortTree(root);
  return root;
})();

/** The same folders as an index for walking paths (shared with the compiler, which times the walk). */
export const dirs = dirIndex(treePaths(IR.tree, IR.files), IR.tree?.partial || []);

/** Follow single-child directory chains (VS Code "compact folders"). */
export function compact(dir: DirNode): { node: DirNode; label: string } {
  let node = dir; const names = [dir.name];
  while (node.files.length === 0 && node.dirList.length === 1 && !node.partial) { node = node.dirList[0]; names.push(node.name); }
  return { node, label: names.join('/') };
}

export interface TreeRow { kind: 'dir' | 'file' | 'more'; path: string; label: string; depth: number; open?: boolean; changed?: number; status?: string | null; embedded?: boolean }

/** Visible rows for the current expansion. `hide(path)` drops files that do not exist yet. */
export function treeRows(expanded: Set<string>, filter: boolean, hide: (path: string) => boolean, made: (dir: string) => boolean = () => false): TreeRow[] {
  const rows: TreeRow[] = [];
  // a folder with nothing to show is not a row (a folder a new file creates appears with it)
  const shows = new Map<DirNode, boolean>();
  const any = (n: DirNode): boolean => {
    let v = shows.get(n);
    if (v === undefined) { v = n.partial || made(n.path) || n.files.some((f) => !hide(f.path)) || n.dirList.some(any); shows.set(n, v); }
    return v;
  };
  const walk = (node: DirNode, depth: number) => {
    for (const d of node.dirList) {
      if (filter && !d.changed) continue;
      if (!any(d)) continue;
      const { node: leaf, label } = compact(d);
      const open = expanded.has(leaf.path);
      rows.push({ kind: 'dir', path: leaf.path, label, depth, open, changed: leaf.changed });
      if (open) walk(leaf, depth + 1);
    }
    for (const f of node.files) {
      const status = changedStatus(f.path);
      if ((filter && !status) || hide(f.path)) continue;
      rows.push({ kind: 'file', path: f.path, label: f.name, depth, status, embedded: !!IR.files[f.path] });
    }
    if (node.partial && node !== treeRoot) rows.push({ kind: 'more', path: node.path + '/…', label: '', depth });
  };
  walk(treeRoot, 0);
  return rows;
}

/** Rows the explorer shows for a set of open folders at time T: files added later stay hidden until they exist. */
export function rowsAt(open: Set<string>, filter: boolean, T: number, focus: string | null, started = true): TreeRow[] {
  return treeRows(open, filter, (p) => {
    if (!started) return false;
    if (rowUntil[p] != null && rowUntil[p] <= T) return true;
    if (rowFrom[p] != null) return rowFrom[p] > T;
    return changedStatus(p) === 'added' && fileBorn[p] != null && fileBorn[p] > T && p !== focus;
  }, (d) => started && rowFrom[d] != null && rowFrom[d] <= T);
}
