// The tour: every changed hunk of every changed file is replayed once, in narrative
// order, and the author's explanation scenes are woven in where they attach
// (`at: {file, hunk?}`). Nothing changed can be skipped. `tour: false` turns it off.
import { isGeneratedFile, isTestFile } from '../repo/lang.ts';
import type { Chapter, Scene, Step, Tempo, TourConfig, View } from '../ir/types.ts';
import type { CompileContext } from './context.ts';

/** Files a step points at. */
export function stepFiles(st: Step): string[] {
  const out = [st.file];
  if (st.do === 'goto') out.push(st.to && st.to.file);
  if (st.do === 'refs' || st.do === 'impact') for (const it of st.items || []) out.push(it.file);
  return out.filter((x): x is string => !!x);
}

// lines that only wire modules together: imports, re-exports, list continuations
const WIRING = /^\s*(import\b|export\s+(\*|\{[^}]*\})\s+from\b|from\s+\S+\s+import\b|require\(|#include\b|use\s|mod\s+\w+;|[A-Za-z_$][\w$]*,?\s*$|\]\s*,?\s*$|\}\s*from\b)/;

interface Item { file: string; hunk: number; of: number; tempo: Tempo }

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
  let next = 0, tk = 0;
  const take = (upto: number): Scene[] => {
    const out: Scene[] = [];
    while (next <= upto && next < items.length) {
      const p = items[next].file;
      const hunks: Item[] = [];
      while (next <= upto && next < items.length && items[next].file === p) hunks.push(items[next++]);
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
          ...hunks.map((h): Step => ({ do: 'replay', file: p, hunk: h.hunk, tempo: h.tempo })),
        ],
      });
    }
    return out;
  };

  const chapters: Chapter[] = [];
  for (const ch of ir.chapters || []) {
    const scs: Scene[] = [];
    for (const sc of ch.scenes || []) {
      if (sc.at?.file) {
        const where = `scene ${sc.id || sc.title}`;
        if (!ir.files[sc.at.file]) cx.warn(where, `at.file "${sc.at.file}" is not in files`);
        let idx = -1;
        items.forEach((it, i) => { if (it.file === sc.at!.file && (sc.at!.hunk == null || it.hunk <= sc.at!.hunk)) idx = i; });
        if (idx < 0 && changed.includes(sc.at.file) && sc.at.hunk) cx.warn(where, `at.hunk ${sc.at.hunk} does not exist in ${sc.at.file}`);
        if (idx >= next) scs.push(...take(idx));
      }
      scs.push(sc);
    }
    chapters.push({ ...ch, scenes: scs });
  }
  if (next < items.length) chapters.push({ id: 'tour-rest', title: cx.t('tour.rest.title'), goal: cx.t('tour.rest.goal'), scenes: take(items.length - 1) });
  ir.chapters = chapters;
  ir.tourStats = { hunks: items.length, files: new Set(items.map((x) => x.file)).size };
}
