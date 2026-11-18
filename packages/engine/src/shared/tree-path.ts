// Folder paths in the explorer, shared by the compiler (to time a file pick) and the player
// (to animate it). A row is a "compact" folder as VS Code shows it: a folder with no files
// and a single subfolder is merged with that subfolder ("src/app/api"), so one row, one click.
//
// Picking a file the way a person does it with the keyboard: close the folders of the old
// file that the new one does not share (deepest first), then open the new file's folders
// (outermost first), one at a time, then select the file.

export interface DirIndex { files: Map<string, number>; subs: Map<string, Set<string>>; partial: Set<string> }

export function dirIndex(paths: Iterable<string>, partial: Iterable<string> = []): DirIndex {
  const files = new Map<string, number>();
  const subs = new Map<string, Set<string>>();
  const sub = (d: string) => { let x = subs.get(d); if (!x) subs.set(d, (x = new Set())); return x; };
  for (const p of paths) {
    const parts = p.split('/');
    const dir = parts.slice(0, -1).join('/');
    files.set(dir, (files.get(dir) || 0) + 1);
    for (let i = 1; i < parts.length; i++) sub(parts.slice(0, i - 1).join('/')).add(parts.slice(0, i).join('/'));
  }
  const part = new Set(partial);
  // a pruned folder is still a row of its parent
  for (const d of part) { const parts = d.split('/'); for (let i = 1; i <= parts.length; i++) sub(parts.slice(0, i - 1).join('/')).add(parts.slice(0, i).join('/')); }
  return { files, subs, partial: part };
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

/** The moves from showing `from` to showing `to`: closes, opens, then the file itself. */
export function foldMoves(ix: DirIndex, from: string | null | undefined, to: string): FoldMove[] {
  const a = chain(ix, from), b = chain(ix, to);
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  return [
    ...a.slice(k).reverse().map((path): FoldMove => ({ kind: 'close', path })),
    ...b.slice(k).map((path): FoldMove => ({ kind: 'open', path })),
    { kind: 'file', path: to },
  ];
}
