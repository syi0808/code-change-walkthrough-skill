// The repository's file tree at head, for the player's explorer, in a compact form:
// a directory table plus [dirIndex, name] pairs. Very large repositories are pruned
// to the directories that lead to files the walkthrough uses; pruned directories are
// listed in `partial` so the explorer can say so.
import path from 'node:path';
import * as G from '../repo/git.ts';
import type { IRFile, Tree } from '../ir/types.ts';

const TREE_LIMIT = 25000;

export function buildTree(repo: string, range: G.Range, files: Record<string, IRFile>): Tree {
  let paths = G.listFiles(repo, range.head);
  const set = new Set(paths);
  for (const p of Object.keys(files)) if (!set.has(p)) { set.add(p); paths.push(p); }
  const partial = new Set<string>();
  if (paths.length > TREE_LIMIT) {
    const keepDirs = new Set(['']);
    for (const p of Object.keys(files)) { const parts = p.split('/'); for (let i = 1; i < parts.length; i++) keepDirs.add(parts.slice(0, i).join('/')); }
    paths = paths.filter((p) => {
      const d = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
      if (keepDirs.has(d)) return true;
      // keep the first directory below a kept one as a (partial) placeholder
      const parts = d.split('/');
      for (let i = parts.length - 1; i >= 1; i--) { const parent = parts.slice(0, i).join('/'); if (keepDirs.has(parent)) { partial.add(parts.slice(0, i + 1).join('/')); break; } }
      if (parts.length >= 1 && !keepDirs.has(parts[0])) partial.add(parts[0]);
      return false;
    });
  }
  paths.sort();
  const dirs: string[] = [];
  const dirIndex = new Map<string, number>();
  const out: [number, string][] = [];
  for (const p of paths) {
    const i = p.lastIndexOf('/');
    const d = i < 0 ? '' : p.slice(0, i);
    if (!dirIndex.has(d)) { dirIndex.set(d, dirs.length); dirs.push(d); }
    out.push([dirIndex.get(d)!, p.slice(i + 1)]);
  }
  // name the root after the repository (origin remote), not the local checkout folder
  const origin = (G.git(repo, ['remote', 'get-url', 'origin'], { allowFail: true }) || '').trim();
  const root = (origin && origin.replace(/\.git$/, '').split(/[/:]/).pop()) || path.basename(repo);
  return { root, dirs, files: out, partial: [...partial].sort(), total: set.size };
}
