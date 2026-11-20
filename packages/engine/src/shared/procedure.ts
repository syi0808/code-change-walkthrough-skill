// Every step is a procedure: a list of phases, one after another, each with its own time.
//
// Two kinds of phase, timed differently:
//   motion  something travels (the editor scrolls, the explorer walks to a file, the pointer moves
//           down a list): it takes the time its amount needs at a speed the eye can follow
//           (moveMs, walkPlan), from amounts the compiler measured (_move, _walk, _itemWalk ...)
//   act     something happens in place (a click, a highlight sweeping in, a flash, a folder
//           opening): a fixed time, whatever its size
// The compiler lays scenes out with these phases and the player reads its progress from them, so
// both agree on when a motion starts and ends, and no motion is squeezed into a share of a fixed
// step time.
//
// Reading paces the scene (layoutScene): a sentence appears together with the code it is about,
// after the motion that brings that code in, and no motion starts while a sentence is still being
// read. The viewer reads, then the screen moves, then the next sentence comes with the next mark.
import type { Scene, Step, Walkthrough } from '../ir/types.ts';
import { BRIDGE, BRIDGE_MAX, delShare, dwellMs, moveMs, narrationItems, readMs, replayMs, typeMs, type NarrationItem } from './timing.ts';

export type PhaseName =
  // open: see openPhases
  | 'locate' | 'travel' | 'press' | 'beat' | 'swap' | 'land' | 'reveal'
  // the explorer walks to the file the step brings into view (no pointer)
  | 'walk'
  // the editor scrolls to the step's place
  | 'scroll'
  // the step's own act: a highlight sweeps in, a focus dims the rest, a note appears
  | 'mark'
  // goto: the pointer travels to the token, Cmd is held, the click, the jump, the flash
  | 'point' | 'cmd' | 'click' | 'jump' | 'flash'
  // refs / impact: the list comes in; then per item (i): point, click, move, mark, hold
  | 'head' | 'move'
  // a replayed edit
  | 'type'
  // file operations in the explorer: New File / F2 / drag, typing the name, Enter; right click, Delete
  | 'select' | 'key' | 'name' | 'enter' | 'grab' | 'drag' | 'drop' | 'menu' | 'aim' | 'remove' | 'close'
  // New Folder before New File: travel to its button, press, type the folder's name, Enter, it opens
  | 'dtravel' | 'dpress' | 'dname' | 'denter' | 'dopen' | 'reach'
  // a second editor group slides in beside the first (Open to the Side), or out when it closes
  | 'split' | 'collapse'
  // peek: the hover with the definition opens over the line
  | 'hover'
  // trace: the debugger steps to the next stop (per stop i), and the call returns
  | 'step' | 'ret'
  // anything else, and the time a step stays before the next
  | 'main' | 'hold';
export interface Phase { name: PhaseName; ms: number; /** refs / impact: the item */ i?: number }

/** Fixed times of acts (ms at 1x). */
const ACT = {
  // a scroll that the compiler expects to be short still gets this much
  scroll: 300,
  mark: { highlight: 520, focus: 560, note: 0, reveal: 0 } as Record<string, number>,
  hold: { highlight: 350, focus: 570, note: 930, reveal: 830 } as Record<string, number>,
  goto: { scroll: 430, point: 790, cmd: 500, click: 290, land: 560, flash: 700 },
  refsHead: 930,
  layout: 600,
  swap: 350,
  /** a group sliding in or out: one object changing size, read as one event */
  split: 520,
  peek: { scroll: 430, point: 790, cmd: 420, hover: 300, mark: 520, hold: 600 },
  trace: { head: 620, step: 280, mark: 380, ret: 1100 },
};

/** Time to take in the values shown at a trace stop: a glance for one short value, longer for several. */
export const valuesMs = (vars: [string, string][]): number => Math.round(Math.min(2200, Math.max(650, 420 + vars.reduce((a, [k, v]) => a + k.length + v.length + 3, 0) * 38)));
/** Other steps: one act of this length. */
const MAIN: Partial<Record<Step['do'], number>> = { diffView: 930, unfocus: 470, graph: 1470, say: 0, wait: 0, clear: 330, close: 470 };
/** A reference list item: base time B, split into point, click, move (at least), mark, hold. */
export const REFS_ITEM = 1730;
/** An impact item also carries a verdict (and a relation) to read. */
export const IMPACT_ITEM = 2400;
export const itemMs = (st: Step): number => (st.do === 'impact' ? IMPACT_ITEM : REFS_ITEM);
const ITEM = { point: 0.2, click: 0.1, move: 0.3, mark: 0.25, hold: 0.15 };

/** The explorer's locate phase for a walk that takes `walk` ms (see walkPlan). */
export const locateMs = (walk = 0): number => Math.max(610, walk);

/**
 * Opening a file is a procedure of separate events, never overlapping (one locus of motion):
 *   locate  the explorer walks to the file: the pointer clicks each folder on the way (walkPlan)
 *   travel  the pointer moves to the row (or tab), which is now still
 *   press   the click
 *   beat    a short pause, so cause and effect read as two events
 *   swap    the file opens, already at its first change; tab, breadcrumbs and orientation update together
 *   walk    (tab click) the explorer walks to the file, as long as the walk needs
 *   land    (same file only) the editor scrolls to the target
 *   reveal  (when asked) the changed lines sweep in
 */
/** Typing a file name: one character per beat, slower than code (a name is read as it is typed). */
export const NAME_CHAR_MS = 75;
export const nameMs = (name: string): number => 250 + name.length * NAME_CHAR_MS;

/**
 * A file that appears in the explorer by a file operation, the way VS Code does it:
 *   create  walk to the folder, (New Folder, type the new folders' path, Enter, it opens,) click New
 *           File, type the name in the row that opens, Enter
 *   rename  walk to the old row, select it, F2, type the new name over the old one, Enter
 *   move    walk to the old row, grab it, drag it onto the new folder (closed folders on the way
 *           open while hovered), drop
 * then the file, now in its place, is clicked open (swap).
 */
function fsPhases(st: Step, nav: (ms: number) => number): Phase[] {
  const op = st._fs!;
  const locate: Phase = { name: 'locate', ms: nav(locateMs(st._walk)) };
  // once the file exists, the explorer follows it to its sorted row (VS Code reveals it)
  const walk: Phase = { name: 'walk', ms: Math.max(250, op.settle || 0) };
  // then the pointer goes to the new row and clicks it open: the file opens because it is clicked
  const open: Phase[] = [walk, { name: 'reach', ms: nav(560) }, { name: 'click', ms: 210 }, { name: 'swap', ms: ACT.swap }];
  if (op.kind === 'create') {
    const folder: Phase[] = op.dir ? [{ name: 'dtravel', ms: nav(690) }, { name: 'dpress', ms: 210 }, { name: 'dname', ms: nameMs(op.dir) }, { name: 'denter', ms: 260 }, { name: 'dopen', ms: Math.max(320, op.reveal || 0) }] : [];
    return [locate, ...folder, { name: 'travel', ms: nav(op.dir ? 420 : 690) }, { name: 'press', ms: 210 }, { name: 'beat', ms: 150 }, { name: 'name', ms: nameMs(op.name) }, { name: 'enter', ms: 260 }, ...open];
  }
  if (op.kind === 'rename') return [locate, { name: 'travel', ms: nav(690) }, { name: 'select', ms: 210 }, { name: 'key', ms: 380 }, { name: 'name', ms: nameMs(op.name) }, { name: 'enter', ms: 260 }, ...open];
  return [locate, { name: 'travel', ms: nav(690) }, { name: 'grab', ms: 260 }, { name: 'drag', ms: Math.max(600, op.drag || 0) }, { name: 'drop', ms: 260 }, ...open];
}

/** Deleting a file in the explorer: the pointer goes to its row, right click, the menu opens, Delete, the row folds away, its tab closes. */
const deletePhases = (): Phase[] => [{ name: 'travel', ms: 690 }, { name: 'menu', ms: 210 }, { name: 'beat', ms: 200 }, { name: 'aim', ms: 380 }, { name: 'press', ms: 210 }, { name: 'remove', ms: 320 }, { name: 'close', ms: 260 }];

export function openPhases(st: Step): Phase[] {
  const kind = st._openKind || 'tree';
  const k = st.fast ? 0.55 : 1;
  const nav = (ms: number) => Math.round(ms * k);
  if (st._fs && kind === 'tree') return [...fsPhases(st, nav), ...(st._reveal ? [{ name: 'reveal', ms: 1270 } as Phase] : [])];
  // Open to the Side: the click on the row, with ⌥ held, puts the file in a second group (see press)
  const out: Phase[] = [];
  if (kind === 'tree') out.push({ name: 'locate', ms: nav(locateMs(st._walk)) }, { name: 'travel', ms: nav(690) }, { name: 'press', ms: nav(210) }, { name: 'beat', ms: nav(150) });
  if (kind === 'tab') out.push({ name: 'travel', ms: nav(560) }, { name: 'press', ms: nav(210) }, { name: 'beat', ms: nav(120) });
  // into a second group: it slides in first, then the file opens in it
  if (st._side && kind !== 'same') out.push({ name: 'split', ms: ACT.split });
  if (kind !== 'same') out.push({ name: 'swap', ms: ACT.swap });
  if (kind === 'tab' && (st._walk || 0) > ACT.swap) out.push({ name: 'walk', ms: st._walk! - ACT.swap });
  if (kind === 'same' && st._r) out.push({ name: 'land', ms: moveMs(st._move || 0, 560) });
  if (st._reveal) out.push({ name: 'reveal', ms: 1270 });
  return out;
}

/** A step's phases (memoized on the step: they depend only on what the compiler recorded on it). */
export function stepPhases(st: Step): Phase[] {
  const memo = st as Step & { __ph?: Phase[] };
  if (memo.__ph) return memo.__ph;
  const ph = build(st);
  Object.defineProperty(memo, '__ph', { value: ph, enumerable: false, configurable: true });
  return ph;
}
function build(st: Step): Phase[] {
  const walk: Phase[] = st._walk && st.do !== 'open' ? [{ name: 'walk', ms: st._walk }] : [];
  const scroll = (px: number | undefined, min = ACT.scroll): Phase => ({ name: 'scroll', ms: Math.round(moveMs(px || 0, min)) });
  switch (st.do) {
    case 'open': return openPhases(st);
    case 'highlight': case 'focus': case 'note': case 'reveal':
      return [...walk, ...(st.reveal !== false ? [scroll(st._move)] : []), { name: 'mark', ms: ACT.mark[st.do] }, { name: 'hold', ms: ACT.hold[st.do] }];
    case 'type': case 'replay': {
      let ms = st.ms != null ? st.ms : st.do === 'type' ? typeMs(st) : replayMs(st);
      // a block opens once its place is in view (the first 40% of its time, see decorate): that share takes what the scroll needs
      if (st.do === 'replay' && st._mode === 'block' && st._move && st.ms == null) ms = Math.max(ms, Math.round(moveMs(st._move) / 0.4));
      return [...walk, { name: 'type', ms }];
    }
    case 'goto': {
      const g = ACT.goto;
      return [
        scroll(st._moveFrom, g.scroll),
        { name: 'point', ms: g.point }, { name: 'cmd', ms: g.cmd }, { name: 'click', ms: g.click },
        { name: 'jump', ms: 0 },
        ...(st._side ? [{ name: 'split', ms: ACT.split } as Phase] : []),
        { name: 'land', ms: Math.round(moveMs(st._move || 0, g.land)) },
        { name: 'flash', ms: g.flash },
      ];
    }
    case 'peek': {
      // the pointer rests on the token, ⌘ is held, the definition opens in a hover, the lines it is about light up
      const g = ACT.peek;
      return [scroll(st._moveFrom, g.scroll), { name: 'point', ms: g.point }, { name: 'cmd', ms: g.cmd }, { name: 'hover', ms: g.hover }, { name: 'mark', ms: st._peek?.mark ? g.mark : 200 }, { name: 'hold', ms: g.hold }];
    }
    case 'trace': {
      // the session starts (the debug toolbar, the call); per stop: the debugger steps to its line (as far as
      // the line is), its values appear beside it and are read; the call returns
      const g = ACT.trace;
      const out: Phase[] = [...walk];
      if (st.call) out.push({ name: 'head', ms: g.head });
      (st._frames || []).forEach((fr, i) => {
        out.push({ name: 'step', ms: Math.round(moveMs(st._frameMove?.[i] || 0, g.step)), i }, { name: 'mark', ms: g.mark, i }, { name: 'hold', ms: valuesMs(fr.vars), i });
      });
      if (st.returns != null) out.push({ name: 'ret', ms: g.ret });
      return out;
    }
    case 'refs': case 'impact': {
      const B = itemMs(st);
      const out: Phase[] = [{ name: 'head', ms: ACT.refsHead }];
      (st._items || []).forEach((_, i) => {
        const move = Math.round(Math.max(B * ITEM.move, st._itemWalk?.[i] || 0, moveMs(st._itemMove?.[i] || 0)));
        out.push({ name: 'point', ms: B * ITEM.point, i }, { name: 'click', ms: B * ITEM.click, i }, { name: 'move', ms: move, i }, { name: 'mark', ms: B * ITEM.mark, i }, { name: 'hold', ms: B * ITEM.hold, i });
      });
      return out;
    }
    // a split closes the way a person closes it: the pointer clicks the right group's tab closed, the group slides out
    case 'layout':
      if (st.mode === 'columns') return [{ name: 'split', ms: ACT.split }];
      if (st._close) return [{ name: 'travel', ms: 560 }, { name: 'click', ms: 210 }, { name: 'collapse', ms: ACT.split }, ...walk];
      return [{ name: 'main', ms: ACT.layout }, ...walk];
    case 'delete': return deletePhases();
    // Go Back: the keys, the jump to the line left (the explorer switches with it), the landing, the flash
    case 'back': return [{ name: 'cmd', ms: 520 }, { name: 'jump', ms: 0 }, { name: 'land', ms: Math.round(moveMs(st._move || 0, 560)) }, { name: 'flash', ms: 700 }];
    case 'wait': return [{ name: 'main', ms: st.ms || 0 }];
    default: return [{ name: 'main', ms: MAIN[st.do] ?? 800 }];
  }
}

export const phasesMs = (ph: Phase[]): number => ph.reduce((a, x) => a + x.ms, 0);

/** A step's time: its phases, or the author's `ms` (the phases are then stretched to it). */
export function stepMs(st: Step): number {
  const own = phasesMs(stepPhases(st));
  if (st.do === 'type' || st.do === 'replay' || st.do === 'wait') return own;
  if (st.do === 'open') return st.ms != null ? st.ms : Math.max(400, own);
  return st.ms != null ? st.ms : own;
}

export interface PhaseAt { name: PhaseName | null; p: number; idx: number; i?: number; /** ms into the phase */ ms: number }
/** Which phase a step-local time falls in, and the progress inside it. Past the end: the last phase at 1. */
export function phaseAt(ph: Phase[], ms: number): PhaseAt {
  let acc = 0;
  for (let k = 0; k < ph.length; k++) {
    if (ms < acc + ph[k].ms) return { name: ph[k].name, p: ph[k].ms ? (ms - acc) / ph[k].ms : 1, idx: k, i: ph[k].i, ms: ms - acc };
    acc += ph[k].ms;
  }
  const last = ph[ph.length - 1];
  return { name: last ? last.name : null, p: 1, idx: ph.length, i: last?.i, ms: last ? last.ms : 0 };
}
/** Step-local ms at which phase `name` (of item `i`) starts, or null. */
export function phaseStart(ph: Phase[], name: PhaseName, i?: number): number | null {
  let acc = 0;
  for (const x of ph) { if (x.name === name && (i === undefined || x.i === i)) return acc; acc += x.ms; }
  return null;
}
/** Progress (0..1) of phase `name` (of item `i`) at step-local `ms`: 0 before it, 1 after it (or when absent). */
export function phaseP(ph: Phase[], ms: number, name: PhaseName, i?: number): number {
  let acc = 0;
  for (const x of ph) {
    if (x.name === name && (i === undefined || x.i === i)) return x.ms ? Math.min(1, Math.max(0, (ms - acc) / x.ms)) : ms >= acc ? 1 : 0;
    acc += x.ms;
  }
  return 1;
}
/** Has the procedure reached (or passed) phase `name`? */
export const reached = (ph: Phase[], ms: number, name: PhaseName): boolean => { const a = phaseStart(ph, name); return a == null || ms >= a; };

/** The step-local time on its phases for a progress p of its laid-out duration (an author's `ms` stretches them). */
export function localMs(st: Step, p: number, dur: number): number {
  const own = phasesMs(stepPhases(st));
  return p >= 1 ? Infinity : p * (dur > 0 ? own : 0);
}

/** Where the sentence about a step arrives: with the step's mark, after the motion that brings its code in. */
const CUE_AT: PhaseName[] = ['mark', 'swap', 'land', 'type', 'head', 'main'];
export function cueOffset(st: Step, dur: number): number {
  const ph = stepPhases(st);
  const own = phasesMs(ph) || 1;
  for (const n of CUE_AT) { const a = phaseStart(ph, n); if (a != null) return (a * (dur || own)) / own; }
  return 0;
}

// ---------------------------------------------------------------- scenes on their clock

export interface Timed { st: Step; start: number; dur: number }

/** Steps that point the viewer at something: the sentence about it should arrive with them. */
const POINTING = new Set<Step['do']>(['highlight', 'focus', 'reveal', 'note', 'goto', 'back', 'peek', 'trace', 'refs', 'impact', 'type', 'graph']);
/** Steps that do not move or change the code on screen: they may run while a sentence is read. */
const STILL = new Set<Step['do']>(['say', 'wait', 'graph', 'clear', 'unfocus']);
/** A sentence that has been read leaves before the screen moves: the time it takes to close (see core/notes OUT). */
export const CLEAR_MS = 260;

/**
 * Give unpinned narration items a step to arrive with. Between two pinned items (or the
 * scene start / end), the unpinned items take the last unpinned pointing steps before the
 * next pin, in order: a sentence appears with the code it is about (temporal contiguity),
 * not at an even spread that can come seconds after or before its highlight.
 */
export function inferCues(steps: Step[], n: number): void {
  const valid = (c: number | undefined) => c !== undefined && Number.isInteger(c) && c >= 1 && c <= n;
  for (const st of steps) st._cue = valid(st.cue) ? st.cue : undefined;
  const pins: { item: number; pos: number }[] = [{ item: 0, pos: -1 }];
  steps.forEach((st, i) => { if (st._cue && st._cue - 1 > pins[pins.length - 1].item) pins.push({ item: st._cue - 1, pos: i }); });
  pins.push({ item: n, pos: steps.length });
  for (let k = 0; k < pins.length - 1; k++) {
    const a = pins[k], b = pins[k + 1];
    const free = b.item - a.item - 1;
    if (free <= 0) continue;
    const cands: number[] = [];
    for (let i = a.pos + 1; i < b.pos; i++) if (!steps[i]._cue && !steps[i].with && POINTING.has(steps[i].do)) cands.push(i);
    const use = cands.slice(-free);
    use.forEach((si, j) => { steps[si]._cue = b.item - use.length + j + 1; });
  }
}
export interface Cues { items: NarrationItem[]; times: number[] }

/** When each narration item appears (scene-local ms). A step may pin an item with `cue: n`: it
 *  arrives with that step's mark (cueOffset). The rest are spread between pins by the time each
 *  needs (dwellMs). layoutScene has already delayed pinned steps so every item gets that time. */
export function cueTimes(sc: Scene, timed: Timed[], lead: number): Cues {
  const items = narrationItems(sc.narration);
  const n = items.length;
  if (!n) return { items, times: [] };
  const starts = timed.map((x) => x.start), ends = timed.map((x) => x.start + x.dur);
  const spanEnd = ends.length ? Math.max(...ends) : 2670;
  const anchors = new Map<number, number>([[0, lead || 0]]);
  for (const x of timed) { const c = x.st._cue ?? x.st.cue; if (c !== undefined && Number.isInteger(c) && c >= 1 && c <= n && !anchors.has(c - 1)) anchors.set(c - 1, x.start + cueOffset(x.st, x.dur)); }
  const w = items.map((it) => dwellMs(it.text));
  if (!anchors.has(n)) {
    // the items after the last pin still get their reading time, even when the steps end sooner
    const last = Math.max(...anchors.keys());
    let need = anchors.get(last)!; for (let i = last; i < n; i++) need += w[i];
    anchors.set(n, Math.max(spanEnd, starts.length ? Math.max(...starts) : 0, need));
  }
  const keys = [...anchors.keys()].sort((a, b) => a - b);
  const times = new Array<number>(n).fill(0);
  for (let a = 0; a < keys.length - 1; a++) {
    const i0 = keys[a], i1 = keys[a + 1], t0 = anchors.get(i0)!, t1 = Math.max(anchors.get(i1)!, t0);
    let tot = 0; for (let i = i0; i < i1; i++) tot += w[i];
    let acc = 0;
    for (let i = i0; i < i1 && i < n; i++) { times[i] = i === i0 ? t0 : t0 + (acc / tot) * (t1 - t0); acc += w[i]; }
  }
  return { items, times };
}

export interface SceneLayout {
  timed: Timed[]; cues: Cues; lead: number; duration: number;
  /** Scene-local times where the screen moves on after a sentence has been read: a voice that is
   *  still speaking holds the timeline there (see the player's narrator). */
  gates: number[];
}

/** Lay out one scene's steps on its local clock. */
export function layoutScene(sc: Scene, lead = 0): SceneLayout {
  let cursor = (sc.auto ? 160 : 470) + lead, prevStart = 0, maxEnd = 0;
  // Reading paces the scene. Narration items and notes are one voice (one thing to read at a
  // time): a step that brings in the next item or a note waits until what is being read has had
  // its time (dwellMs), and so does any step that moves the code: the screen never moves under a
  // sentence being read.
  const items = narrationItems(sc.narration);
  if (!sc.auto) inferCues(sc.steps || [], items.length);
  let pinIdx = 0;
  let ready = items.length ? lead + dwellMs(items[0].text) : 0; // when the current voice has been read
  const gates: number[] = [];
  // a step that moves the code starts once the sentence on screen has been read, and that sentence
  // closes first (a gate): the viewer reads, the sentence goes, the screen moves, the next one comes
  const gate = (st: Step, start: number): number => {
    if (sc.auto || st.with || STILL.has(st.do) || !items.length) return start;
    start = Math.max(start, ready);
    gates.push(start);
    return start + CLEAR_MS;
  };
  const timed = (sc.steps || []).map((st): Timed => {
    const dur = stepMs(st);
    if (st.do === 'type' || st.do === 'replay') { const ty = stepPhases(st).find((x) => x.name === 'type'); st._dp = delShare(st, ty ? ty.ms : dur); }
    let hold = st.hold || 0;
    if (st.do === 'say') hold += readMs(st.text);
    let start = st.with ? prevStart : cursor;
    const c = st._cue;
    const off = cueOffset(st, dur);
    if (c !== undefined && Number.isInteger(c) && c - 1 > pinIdx && c <= items.length) {
      // unpinned items in between are read first; the motion before the mark starts once they are
      for (let i = pinIdx + 1; i < c - 1; i++) ready += dwellMs(items[i].text);
      start = gate(st, Math.max(start, ready));
      pinIdx = c - 1; ready = start + off + dwellMs(items[c - 1].text);
    } else if (st.do === 'note' && !sc.auto) {
      start = gate(st, Math.max(start, ready));
      ready = start + off + dwellMs(st.text);
    } else start = gate(st, start);
    prevStart = start;
    cursor = Math.max(st.with ? cursor : 0, start + dur + hold);
    maxEnd = Math.max(maxEnd, cursor);
    return { st, start, dur };
  });
  const cues = cueTimes(sc, timed, lead);
  const lastCue = cues.times.length ? cues.times[cues.times.length - 1] + dwellMs(cues.items[cues.items.length - 1].text) : 0;
  // tour segments carry no narration: no reading time, no dwell
  if (sc.auto) return { timed, cues, lead, duration: maxEnd + 330, gates: [] };
  return { timed, cues, lead, duration: Math.max(maxEnd + 930, lastCue + 530, ready + 530, lead + 3330), gates };
}

/** The bridge card stays until its sentence can be read (the question stays on screen all scene). */
export const leadFor = (sc: Scene, index: number): number =>
  // an author scene, or a tour scene that previews the explanation after it; not a scene already previewed
  index && (!sc.auto || sc.bridge) && !sc._previewed ? Math.min(BRIDGE_MAX, Math.max(BRIDGE, sc.bridge ? readMs(sc.bridge) + 530 : 0)) : 0;

/** Total duration of an IR in ms at 1x. */
export function totalMs(ir: Pick<Walkthrough, 'chapters'>): number {
  let t = 0, i = 0;
  for (const ch of ir.chapters || []) for (const sc of ch.scenes || []) { t += layoutScene(sc, leadFor(sc, i)).duration; i++; }
  return t;
}
