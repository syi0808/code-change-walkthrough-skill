// The tour: every changed hunk of every changed file is replayed once, in narrative
// order, and the author's explanation scenes are woven in where they attach
// (`at: {file, hunk?}`). Nothing changed can be skipped. `tour: false` turns it off.
// A file is written before anything shows it, and after what it uses that has no
// explanation of its own (see `dependencies`): the code always builds on code already there.
import { extractImports, extractSymbols, isGeneratedFile, isTestFile, resolveImport } from '../repo/lang.ts';
import type { Chapter, Scene, Step, Tempo, TourConfig, View } from '../ir/types.ts';
import type { CompileContext } from './context.ts';

/** Files a step points at. */
export function stepFiles(st: Step): string[] {
  const out = [st.file];
  if (st.do === 'goto' || st.do === 'peek') out.push(st.to && st.to.file, st.from && st.from.file);
  if (st.do === 'refs' || st.do === 'impact') for (const it of st.items || []) out.push(it.file);
  return out.filter((x): x is string => !!x);
}

// lines that only wire modules together: imports, re-exports, list continuations
const WIRING = /^\s*(import\b|export\s+(\*|\{[^}]*\})\s+from\b|from\s+\S+\s+import\b|require\(|#include\b|use\s|mod\s+\w+;|[A-Za-z_$][\w$]*,?\s*$|\]\s*,?\s*$|\}\s*from\b)/;

interface Item { file: string; hunk: number; of: number; tempo: Tempo }

/**
 * What each changed file uses among the other changed files: what it imports (relative paths and
 * re-exports), and the names declared on the added lines of another file that its own added lines
 * use (which also finds imports through path aliases). Heuristic, like every analysis here.
 */
export function dependencies(cx: CompileContext, changed: string[]): Map<string, string[]> {
  const ir = cx.ir;
  const universe = new Set(changed);
  const added = new Map<string, { lines: Set<number>; text: string }>();
  for (const p of changed) {
    const lines = new Set<number>();
    for (const b of cx.changeBlocks(p)) if (b.newFrom != null) for (let n = b.newFrom; n <= b.newTo!; n++) lines.add(n);
    added.set(p, { lines, text: [...lines].map((n) => cx.lineText(p, 'after', n)).join('\n') });
  }
  const declared = new Map<string, Set<string>>();
  for (const p of changed) {
    const f = ir.files[p];
    const own = added.get(p)!.lines;
    declared.set(p, new Set(extractSymbols(f.after, f.language || '').filter((x) => own.has(x.line) && x.name.length >= 4).map((x) => x.name)));
  }
  const deps = new Map<string, string[]>();
  for (const a of changed) {
    const out = new Set<string>();
    for (const spec of extractImports(ir.files[a].after)) for (const t of resolveImport(a, spec, universe)) if (t !== a) out.add(t);
    const text = added.get(a)!.text;
    if (text) for (const b of changed) {
      if (b === a || out.has(b)) continue;
      for (const name of declared.get(b)!) {
        if (declared.get(a)!.has(name)) continue;
        if (new RegExp(`(^|[^\\w$])${name.replace(/\$/g, '\\$')}([^\\w$]|$)`).test(text)) { out.add(b); break; }
      }
    }
    deps.set(a, [...out]);
  }
  return deps;
}

export function expandTour(cx: CompileContext): void {
  const ir = cx.ir;
  if (ir.tour === false) return;
  const tour: TourConfig = ir.tour && typeof ir.tour === 'object' ? ir.tour : {};
  const changed = Object.entries(ir.files)
    .filter(([p, f]) => f.status !== 'context' && !isGeneratedFile(p) && (f.before != null || f.after != null) && !(f.before != null && f.after != null && f.before === f.after && !f.oldPath))
    .map(([p]) => p);

  // file order: the author's tour.order, then files the scenes use, then the rest (tests last)
  const order: string[] = [];
  const push = (p: string) => { if (changed.includes(p) && !order.includes(p)) order.push(p); };
  for (const p of tour.order || []) { if (!ir.files[p]) cx.warn('tour.order', `unknown file "${p}"`); push(p); }
  for (const ch of ir.chapters || []) for (const sc of ch.scenes || []) { if (sc.at?.file) push(sc.at.file); for (const st of sc.steps || []) stepFiles(st).forEach(push); }
  changed.filter((p) => !isTestFile(p)).sort().forEach(push);
  changed.sort().forEach(push);

  const isBarrel = (p: string) => {
    const t = ir.files[p].after;
    return /(^|\/)(index|__init__|mod)\.[a-z]+$/.test(p) && t != null && t.split('\n').every((l) => !l.trim() || WIRING.test(l) || /^\s*export\s+\*/.test(l));
  };
  const attached = new Set<string>();
  for (const ch of ir.chapters || []) for (const sc of ch.scenes || []) if (sc.at?.file && sc.at.hunk) attached.add(`${sc.at.file}#${sc.at.hunk}`);

  // hunks per file, each with a tempo: typed (key), line by line (normal), or a block (skim)
  const items: Item[] = [];
  for (const p of order) {
    const blocks = cx.changeBlocks(p);
    // a file moved or renamed without a change to its text: its tour scene is the move itself
    if (!blocks.length && ir.files[p].oldPath) { items.push({ file: p, hunk: 0, of: 0, tempo: 'skim' }); continue; }
    blocks.forEach((b, i) => {
      const key = `${p}#${i + 1}`;
      const lines: string[] = [];
      if (b.newFrom != null) for (let n = b.newFrom; n <= b.newTo!; n++) lines.push(cx.lineText(p, 'after', n));
      if (b.oldFrom != null) for (let n = b.oldFrom; n <= b.oldTo!; n++) lines.push(cx.lineText(p, 'before', n));
      const wiringOnly = lines.length <= 6 && lines.every((l) => !l.trim() || WIRING.test(l));
      const auto: Tempo = isBarrel(p) || wiringOnly ? 'skim' : attached.has(key) ? 'key' : 'normal';
      items.push({ file: p, hunk: i + 1, of: blocks.length, tempo: tour.tempo?.[key] || tour.tempo?.[p] || auto });
    });
  }

  const viewFor = (p: string): View => { const f = ir.files[p]; return f.status === 'added' || f.before == null ? 'after' : 'diff'; };
  const deps = dependencies(cx, changed);
  // files with an explanation of their own: written where that explanation stands, not pulled forward
  const scened = new Set<string>();
  for (const ch of ir.chapters || []) for (const sc of ch.scenes || []) if (sc.at?.file) scened.add(sc.at.file);
  const itemsOf = new Map<string, number[]>();
  items.forEach((it, i) => { if (!itemsOf.has(it.file)) itemsOf.set(it.file, []); itemsOf.get(it.file)!.push(i); });
  const done = new Set<number>();
  const written = (p: string) => (itemsOf.get(p) || []).every((i) => done.has(i));
  /** Can `d` be written now, together with what it uses? Not when it waits for its own explanation, or uses something that does. */
  const ready = (d: string, seen: Set<string>): boolean => {
    if (written(d)) return true;
    if (scened.has(d) || seen.has(d) || !itemsOf.has(d)) return false;
    seen.add(d);
    return (deps.get(d) || []).every((e) => ready(e, seen));
  };
  let seq: number[] = [];
  // pairs (file, what it uses) where a file is written before code it uses that is explained later
  const forward: [string, string][] = [];
  /** Write file p (its items up to index `upto`), first the not yet written files it uses that can be. */
  const write = (p: string, upto = Infinity) => {
    for (const d of deps.get(p) || []) if (!written(d) && ready(d, new Set([p]))) write(d);
    for (const d of deps.get(p) || []) if (!written(d) && scened.has(d) && !forward.some(([a, b]) => a === p && b === d)) forward.push([p, d]);
    for (const i of itemsOf.get(p) || []) if (i <= upto && !done.has(i)) { done.add(i); seq.push(i); }
  };
  let tk = 0;
  /** The items written since the last flush, as tour scenes: one per run of the same file. */
  const flush = (): Scene[] => {
    const out: Scene[] = [];
    for (let k = 0; k < seq.length;) {
      const p = items[seq[k]].file;
      const hunks: Item[] = [];
      while (k < seq.length && items[seq[k]].file === p) hunks.push(items[seq[k++]]);
      const parts = p.split('/');
      const base = parts[parts.length - 1];
      const generic = /^(index|__init__|mod|main|types|utils?|constants?)\.[a-z]+$/i.test(base);
      const name = generic && parts.length > 1 ? parts.slice(-2).join('/') : base;
      const cont = hunks[0].hunk > 1;
      out.push({
        id: `tour-${++tk}`, auto: true, narration: '',
        title: cont ? cx.t('tour.cont', { name }) : name,
        question: tour.questions?.[p] || cx.t('tour.question', { name }),
        tour: { file: p, hunks: hunks.map((h) => h.hunk), of: hunks[0].of },
        steps: [
          { do: 'open', file: p, view: viewFor(p), noReveal: true, fast: hunks.every((h) => h.tempo === 'skim') },
          ...hunks.filter((h) => h.hunk > 0).map((h): Step => ({ do: 'replay', file: p, hunk: h.hunk, tempo: h.tempo })),
          // a deleted file, once its removal has been replayed, is deleted from the explorer
          ...(ir.files[p].status === 'deleted' && hunks[hunks.length - 1].hunk === hunks[hunks.length - 1].of ? [{ do: 'delete', file: p } as Step] : []),
        ],
      });
    }
    seq = [];
    return out;
  };

  const chapters: Chapter[] = [];
  for (const ch of ir.chapters || []) {
    const scs: Scene[] = [];
    for (const sc of ch.scenes || []) {
      let idx = -1;
      if (sc.at?.file) {
        const where = `scene ${sc.id || sc.title}`;
        if (!ir.files[sc.at.file]) cx.warn(where, `at.file "${sc.at.file}" is not in files`);
        items.forEach((it, i) => { if (it.file === sc.at!.file && (sc.at!.hunk == null || it.hunk <= sc.at!.hunk)) idx = i; });
        if (idx < 0 && changed.includes(sc.at.file) && sc.at.hunk) cx.warn(where, `at.hunk ${sc.at.hunk} does not exist in ${sc.at.file}`);
      }
      const at = idx >= 0 ? sc.at!.file : null;
      // what the tour order puts before this stop
      for (let i = 0; i <= idx; i++) if (!done.has(i) && items[i].file !== at) write(items[i].file, i);
      // every changed file the scene shows is written before it is shown (a file is never visited, then created)
      const shown: string[] = [];
      for (const st of sc.steps || []) for (const f of stepFiles(st)) if (f !== at && itemsOf.has(f) && !shown.includes(f)) shown.push(f);
      for (const f of shown) write(f);
      // then the file the scene explains, last, so its explanation opens its replay
      if (at) write(at, idx);
      const tours = flush();
      scs.push(...tours);
      if (at) {
        // The explanation of a file is announced before the file is written, not after: the replay
        // of the file it explains opens with its bridge and asks its question, so the code arriving
        // line by line has a purpose the viewer already knows (an advance organizer).
        let k = tours.length;
        while (k > 0 && tours[k - 1].tour?.file === at) k--;
        const run = tours.slice(k);
        if (run.length && sc.bridge) {
          run[0].bridge = sc.bridge;
          for (const t of run) if (sc.question) t.question = sc.question;
          sc._previewed = true;
        }
      }
      scs.push(sc);
    }
    chapters.push({ ...ch, scenes: scs });
  }
  items.forEach((it, i) => { if (!done.has(i)) write(it.file, i); });
  if (seq.length) chapters.push({ id: 'tour-rest', title: cx.t('tour.rest.title'), goal: cx.t('tour.rest.goal'), scenes: flush() });
  ir.chapters = chapters;
  if (forward.length) {
    const ex = forward.slice(0, 3).map(([a, b]) => `${a.split('/').pop()} → ${b.split('/').pop()}`).join(', ');
    cx.warn('tour', `${forward.length} time(s) a file is written before code it uses that is explained later (${ex}${forward.length > 3 ? ', …' : ''}): order the scenes definitions first (R22), so each file is written after what it uses and its names are already known`);
  }
  ir.tourStats = { hunks: items.filter((x) => x.hunk > 0).length, files: new Set(items.map((x) => x.file)).size };
}
