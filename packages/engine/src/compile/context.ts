// Shared state of one compilation: the IR being compiled, diagnostics, and cached
// views of file contents (lines per side, change blocks).
import { translator, type Table, type Translate } from '../i18n/index.ts';
import { compute, splitLines } from '../shared/diff.ts';
import { dirIndex, type DirIndex } from '../shared/tree-path.ts';
import type { Diagnostic, LineRange, Side, View, Walkthrough } from '../ir/types.ts';

export interface ChangeBlock { oldFrom: number | null; oldTo: number | null; newFrom: number | null; newTo: number | null }

export class CompileContext {
  readonly errors: Diagnostic[] = [];
  readonly warnings: Diagnostic[] = [];
  private readonly lines = new Map<string, string[] | null>();
  private readonly blocks = new Map<string, ChangeBlock[]>();

  /** The explorer's folders (the repository tree when there is one), to time file picks. */
  dirs: DirIndex = dirIndex([]);
  /** UI strings for names the compiler generates (tour scenes). */
  readonly t: Translate;

  constructor(readonly ir: Walkthrough, i18n: Table | null = null) { this.t = translator(i18n); }

  err(path: string, message: string): void { this.errors.push({ path, message }); }
  warn(path: string, message: string): void { this.warnings.push({ path, message }); }

  linesOf(file: string, side: Side): string[] | null {
    const key = file + '\0' + side;
    if (!this.lines.has(key)) {
      const t = this.ir.files[file]?.[side];
      this.lines.set(key, t == null ? null : splitLines(t));
    }
    return this.lines.get(key)!;
  }

  lineText(file: string, side: Side, line: number): string { return (this.linesOf(file, side) || [])[line - 1] || ''; }

  /** Contiguous change blocks (the tour's "hunks"), numbered from 1 in file order. */
  changeBlocks(file: string): ChangeBlock[] {
    if (!this.blocks.has(file)) {
      const f = this.ir.files[file];
      const { rows } = compute(f.before, f.after, { algorithm: 'patience' });
      const out: ChangeBlock[] = [];
      let cur: ChangeBlock | null = null;
      for (const r of rows) {
        if (r.type === 'eq') { cur = null; continue; }
        if (!cur) { cur = { oldFrom: null, oldTo: null, newFrom: null, newTo: null }; out.push(cur); }
        if (r.old) { cur.oldFrom = cur.oldFrom ?? r.old; cur.oldTo = r.old; }
        if (r.new) { cur.newFrom = cur.newFrom ?? r.new; cur.newTo = r.new; }
      }
      this.blocks.set(file, out);
    }
    return this.blocks.get(file)!;
  }

  defaultSide(file: string, view: View | undefined): Side {
    if (view === 'before') return 'before';
    const f = this.ir.files[file];
    if (f && f.after == null) return 'before';
    return 'after';
  }

  /** What a replay animates in a range: characters of added lines (indentation excluded) and removed lines. */
  typedText(file: string, view: View, r: LineRange): { chars: number; dels: number; lines: number } {
    const f = this.ir.files[file];
    if (f.after == null) return { chars: 0, dels: (this.linesOf(file, 'before') || []).slice(r.from - 1, r.to).length, lines: 0 };
    let chars = 0, dels = 0, lines = 0;
    const plainAll = view === 'after' && (f.status === 'added' || f.status === 'context' || f.before == null);
    if (plainAll) {
      for (const l of (this.linesOf(file, 'after') || []).slice(r.from - 1, r.to)) { chars += l.trim().length; lines++; }
      return { chars, dels, lines };
    }
    const { rows } = compute(f.before, f.after, { algorithm: 'patience' });
    // the row span covered by the range (contiguous, so removed lines in between count)
    const key = r.side === 'before' ? 'old' : 'new';
    const idx = rows.map((x, i) => ((x[key] ?? 0) >= r.from && (x[key] ?? 0) <= r.to ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return { chars, dels, lines };
    for (const x of rows.slice(idx[0], idx[idx.length - 1] + 1)) {
      if (x.type === 'add' || (x.type === 'mod' && !x.ws)) { chars += (x.newText || '').trim().length; lines++; }
      if (x.type === 'del' || (x.type === 'mod' && !x.ws)) dels++;
    }
    return { chars, dels, lines };
  }
}
