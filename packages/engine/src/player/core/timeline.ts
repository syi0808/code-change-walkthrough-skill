// The timeline: every scene laid out on one clock (see shared/timing.ts), plus the
// tour's global facts (each replay, when files appear and disappear).
import { layoutScene, leadFor, openPhases, phasesMs, type Cues, type Timed } from '../../shared/timing.ts';
import type { Chapter, Scene, Step } from '../../ir/types.ts';
import { IR } from './env.ts';

export interface SceneRT extends Scene {
  id: string;
  ci: number;
  si: number;
  chapter: Chapter;
  lead: number;
  timed: Timed[];
  cues: Cues;
  duration: number;
  t0: number;
  /** The first file the scene looks at (for the bridge card). */
  where: string | null;
  /** Scene-local time at which the scene's file opens on screen (after the explorer walk and the click). */
  swapAt: number;
  /** Scene-local time at which that opening has settled (author scenes: once the bridge card is in). */
  swapEnd: number;
}

export const scenes: SceneRT[] = [];
IR.chapters.forEach((ch, ci) => (ch.scenes || []).forEach((sc, si) => {
  scenes.push({ ...sc, id: sc.id || `${ci}-${si}`, ci, si, chapter: ch, lead: 0, timed: [], cues: { items: [], times: [] }, duration: 0, t0: 0, where: null, swapAt: 0, swapEnd: 0 });
}));

export let total = 0;
scenes.forEach((sc, idx) => {
  const lay = layoutScene(sc, leadFor(sc, idx));
  Object.assign(sc, { lead: lay.lead, timed: lay.timed, cues: lay.cues, duration: lay.duration, t0: total });
  total += sc.duration;
  const st0 = (sc.steps || []).find((x) => x.file || x._file || x._to?.file || x._items?.length);
  sc.where = st0 ? st0.file || st0._file || st0._to?.file || st0._items![0].file : null;
  const first = sc.timed[0];
  if (!sc.auto && sc.lead) sc.swapEnd = Math.min(sc.lead, 670);
  if (sc.auto && first && first.st.do === 'open' && first.st._openKind !== 'same') {
    const ph = openPhases(first.st);
    const swapI = ph.findIndex((x) => x.name === 'swap');
    sc.swapAt = first.start + phasesMs(ph.slice(0, Math.max(0, swapI)));
    sc.swapEnd = sc.swapAt + (swapI >= 0 ? ph[swapI].ms : 0);
  }
});

let sid = 0;
for (const sc of scenes) for (const t of sc.timed) { t.st._id = ++sid; t.st._start = t.start; }

export function sceneAt(T: number): number {
  let k = 0;
  while (k < scenes.length - 1 && T >= scenes[k].t0 + scenes[k].duration) k++;
  return k;
}

// ---- the tour: every replay, each file's replay span, and when files appear / disappear
export interface Replay { st: Step; g: number; end: number; file: string }
export const replays: Replay[] = [];
/** Per file: from its tour scene's start to its last replay's end (unreplayed hunks are hidden inside). */
export const fileSpan: Record<string, { from: number; to: number }> = {};
export const fileBorn: Record<string, number> = {};
export const fileGone: Record<string, number> = {};
for (const sc of scenes) for (const x of sc.timed) {
  const g = sc.t0 + x.start, st = x.st;
  const targets = [st.file, st._file, st._to?.file, ...(st._items || []).map((it) => it.file)].filter((f): f is string => !!f);
  for (const f of targets) if (fileBorn[f] == null) fileBorn[f] = g;
  if (st.do !== 'replay' || !st._r || !st._file) continue;
  replays.push({ st, g, end: g + x.dur, file: st._file });
  // the file holds its unwritten state from the moment its tour scene opens it, not from
  // the first replay: otherwise the finished file shows, then vanishes, then is written
  const from = sc.auto ? sc.t0 : g;
  const sp = fileSpan[st._file] || (fileSpan[st._file] = { from, to: g + x.dur });
  sp.from = Math.min(sp.from, from); sp.to = Math.max(sp.to, g + x.dur);
  if (IR.files[st._file] && IR.files[st._file].after == null) fileGone[st._file] = Math.max(fileGone[st._file] || 0, g + x.dur);
}
