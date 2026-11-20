// The walkthrough state is a pure function of timeline time:
//   state(T) = reduce(snapshot at scene start, steps started by T, their progress)
// so play, pause, scrub, speed and scene jumps all just pick a T.
import { glide, walkAt } from '../../shared/timing.ts';
import { localMs, NAME_CHAR_MS, nameMs, phaseAt, phaseP, phasesMs, phaseStart, reached, stepPhases, type PhaseName } from '../../shared/procedure.ts';
import { chain, foldMoves, inFolder, walkPlan } from '../../shared/tree-path.ts';
import type { DiffSettings, Effect, GraphEdge, GraphNode, LineRange, RefItem, ReplayMode, Side, Step, View } from '../../ir/types.ts';
import { clamp, clone, ease, IR, t } from './env.ts';
import { fileSpan, replays, sceneAt, scenes } from './timeline.ts';
import { dirs } from './tree.ts';
import { settleTop, walkTop } from './explorer.ts';

export interface ScrollTarget { side: Side; from?: number; to?: number; line?: number }
export interface Scroll { to: ScrollTarget; mode: 'center' | 'top' | 'ensure' | 'follow'; p: number; prev: Scroll | null; /** timeline ms the move takes (0: unknown); the move is held to a followable speed (see scrollFrame) */ ms?: number }
export interface Hl extends LineRange { tone: string; label: string | null; p: number; key: string | number; t?: number; ref?: boolean }
export interface NoteState { side: Side; line: number; text: string; tone: string; key: number; t: number }
export interface CodeAnchor { kind: 'code'; pane: number; side: Side; line: number; token?: string }
export type Anchor = { kind: 'ex'; path: string } | { kind: 'tab'; pane: number; file: string } | { kind: 'tabClose'; pane: number; file: string } | { kind: 'ref'; index: number } | { kind: 'exNew' } | { kind: 'exNewDir' } | { kind: 'exMenu' } | CodeAnchor;
export interface Pointer { from: Anchor | null; to: Anchor | null; p: number; click?: boolean; fade?: boolean }
export interface Typing extends LineRange { key: number; file: string; p: number; t: number; mode: ReplayMode; dp?: number }

export interface PaneState {
  tabs: string[];
  file: string | null;
  view: View;
  diff: DiffSettings;
  scroll: Scroll | null;
  mem: Record<string, ScrollTarget>;
  hl: Hl[];
  focus: (LineRange & { p: number; t: number }) | null;
  notes: NoteState[];
  /** A jump target flashes once; p is how far the flash has faded. */
  flash: (LineRange & { key: string; p: number }) | null;
  tokline: CodeAnchor | null;
  /** The file entering after a click: its code fades in over this progress. */
  enter: { key: number; p: number } | null;
  /** Pane 1: what the two groups are read side by side for (the label of the step that split). */
  why: string | null;
  /** A ⌘-hover over a token: the definition in a hover (p: its opening, mp: the lines in it lighting up). */
  peek: PeekState | null;
  /** A debug session (trace): where it is paused, the values shown beside the lines, the result. */
  trace: TraceState | null;
}
export interface PeekState { file: string; side: Side; from: number; to: number; mark: { from: number; to: number } | null; at: CodeAnchor; p: number; mp: number; key: number }
export interface TraceValue { k: string; v: string; /** scene-local time it appeared */ t: number; /** the value differs from the one shown for this name before */ changed: boolean }
export interface TraceState {
  session: number;
  call: string | null;
  /** the toolbar coming in (0..1) and going out once the call returned (`end`: 0..1) */
  headP: number;
  end: number;
  /** the line paused on, the one before it, and how far the stop has moved from that one to this (0..1) */
  cur: { side: Side; line: number } | null;
  prev: { side: Side; line: number } | null;
  q: number;
  /** Step Over is being pressed */
  stepping: boolean;
  vals: { side: Side; line: number; items: TraceValue[] }[];
  ret: { side: Side; line: number; text: string; t: number } | null;
}
export interface GraphState { nodes: GraphNode[]; edges: GraphEdge[]; title: string; size?: 'full' | 'panel'; highlight?: string[]; key: number }
export interface State {
  layout: 'single' | 'columns';
  active: number;
  panes: [PaneState, PaneState];
  pointer: Pointer | null;
  /** Where the pointer last came to rest: the next move starts there. */
  pointerAt: Anchor | null;
  keys: string[] | null;
  /** What the keys do with the pointer (click, hover), shown after them. */
  keysHint: string | null;
  /** How far the second editor group is open (0..1): it slides in and out on the timeline. */
  split: number;
  toast: string | null;
  /** Scene-local time the toast appeared: it names the command for a moment, then goes (it would cover the code's header). */
  toastAt: number;
  refs: { kind: 'refs' | 'impact'; symbol?: string; title: string | null; change?: string; items: RefItem[]; active: number } | null;
  graph: GraphState | null;
  map: GraphState | null;
  say: string;
  typing: Typing[];
  /** A file being picked in the explorer. */
  exFocus: string | null;
  /** The explorer moving to a file: linear progress of the "locate" phase (or of the swap after a tab click).
   *  It walks from `from` (the file shown until now) to `file`: folders close and open one at a time
   *  (shared/tree-path foldMoves), each clicked by the pointer when `cursor` is set. `pick` is the
   *  selection's move onto the file itself (the click on its row). */
  exScroll: { file: string; from: string | null; p: number; pick: number; cursor: boolean; key: number; keep?: boolean } | null;
  /** File operations in the explorer (see FsOp and the delete step): the inline name box (`sel`: the old
   *  name selected, about to be typed over), the row being dragged onto a folder, the context menu (`hot`:
   *  Delete under the pointer), and the row folding away. */
  exEdit: { mode: 'create' | 'mkdir' | 'rename'; at: string; text: string; sel: boolean } | null;
  exDrag: { path: string; to: string; p: number } | null;
  exMenu: { path: string; hot: boolean } | null;
  exRemove: { path: string; p: number } | null;
  /** The explorer's scroll (px): kept in the state like everything else on screen (see core/explorer.ts). */
  exTop: number;
  reveal: { file: string; p: number } | null;
  scene: number;
  sceneP: number;
  sceneT: number;
  /** The scene the orientation shows: a tour scene takes over when its file opens, not before. */
  shown: number;
  /** The scene the outline panel highlights: it changes together with the screen change, not during a replay. */
  guideScene: number;
  bridge: { p: number } | null;
  /** In a drill-down (a goto a `back` will return from): the line it left, shown until the return. */
  detour: { file: string; line: number; side: Side } | null;
}

/** An impact item lights up in the colour of its verdict. */
const EFFECT_TONE: Record<Effect, string> = { safe: 'info', check: 'warn', breaks: 'remove', updated: 'add' };

export const DIFF_DEFAULT: DiffSettings = { mode: 'unified', algorithm: 'patience', granularity: 'word', context: 3, whitespace: 'collapse' };
const newPane = (): PaneState => ({ tabs: [], file: null, view: 'after', diff: { ...DIFF_DEFAULT }, scroll: null, mem: {}, hl: [], focus: null, notes: [], flash: null, tokline: null, enter: null, why: null, peek: null, trace: null });
const initState = (): State => ({ layout: 'single', active: 0, panes: [newPane(), newPane()], pointer: null, pointerAt: null, keys: null, keysHint: null, split: 0, toast: null, toastAt: 0, refs: null, graph: null, map: null, say: '', typing: [], exFocus: null, exScroll: null, exEdit: null, exDrag: null, exMenu: null, exRemove: null, exTop: 0, reveal: null, scene: 0, sceneP: 0, sceneT: 0, shown: 0, guideScene: 0, bridge: null, detour: null });

function resetTransient(s: State): void {
  for (const p of s.panes) { p.hl = []; p.focus = null; p.notes = []; p.flash = null; p.tokline = null; p.enter = null; p.peek = null; p.trace = null; }
  if (s.pointer?.to) s.pointerAt = s.pointer.to;
  s.pointer = null; s.keys = null; s.keysHint = null; s.toast = null; s.refs = null; s.graph = null; s.say = ''; s.typing = []; s.exFocus = null; s.exScroll = null; s.exEdit = null; s.exDrag = null; s.exMenu = null; s.exRemove = null; s.reveal = null;
}

/** Where a finished scroll is placed depends on the scrolls before it while it is relative
 *  ("ensure" keeps the place it found, "follow" carries on from its base), and not at all once
 *  it is absolute ("center", "top"). The chain is kept back to the first absolute one, exactly:
 *  cutting it anywhere else would place the same target elsewhere one step later (a jump). */
function settled(sc: Scroll | null): Scroll | null {
  if (!sc || !sc.to) return null;
  const relative = sc.mode === 'ensure' || sc.mode === 'follow';
  // sc.prev was settled when sc was set, so only this link changes
  return { ...sc, p: 1, prev: relative ? sc.prev : null };
}

export function setScroll(pane: PaneState, to: ScrollTarget, mode: Scroll['mode'], p: number, ms = 0): void {
  pane.scroll = { to, mode, p, prev: settled(pane.scroll), ms };
  if (pane.file) pane.mem[pane.file] = to;
}

const defaultView = (file: string): View => {
  const f = IR.files[file];
  return !f || f.status === 'context' || f.status === 'added' ? 'after' : f.status === 'deleted' ? 'before' : 'diff';
};
export function showFile(s: State, pi: number, file: string, view?: View): PaneState {
  const pane = s.panes[pi];
  if (pi === 1) { s.layout = 'columns'; s.split = 1; }
  s.active = pi;
  const f = IR.files[file];
  if (f) {
    if (!view) view = pane.file === file ? pane.view : defaultView(file);
    if (view === 'after' && f.after == null) view = 'before';
    if (view === 'before' && f.before == null) view = 'after';
  } else view = 'after'; // a file without embedded content (explorer browsing)
  if (!pane.tabs.includes(file)) pane.tabs.push(file);
  if (pane.file !== file) {
    pane.file = file;
    pane.view = view;
    const mem = pane.mem[file];
    pane.scroll = { to: mem || { side: view === 'before' ? 'before' : 'after', line: 1 }, mode: mem ? 'center' : 'top', p: 1, prev: null };
  } else pane.view = view;
  return pane;
}

/** The explorer follows a change of the file in view along the path, without the pointer (q: 0..1 of its walk). */
function follow(s: State, from: string | null, to: string, q: number, key: number): void {
  if (!from || from === to) return;
  s.exScroll = { file: to, from, p: q, pick: q, cursor: false, key };
  s.exTop = walkTop(s.exTop, from, to, q, nowT);
}

/** How a step is being played at progress p of its laid-out duration: its phases, where it is on
 *  them, and the scene-local time a phase starts at (an author's `ms` stretches the phases). */
function procedure(st: Step, p: number, dur: number) {
  const ph = stepPhases(st);
  const own = phasesMs(ph) || 1;
  const ms = localMs(st, p, dur);
  const scale = (dur || own) / own;
  return {
    ph, ms,
    at: phaseAt(ph, ms),
    /** progress of a phase: 0 before it, 1 after it or when the step has none */
    pp: (name: PhaseName, i?: number) => (ms === Infinity ? 1 : phaseP(ph, ms, name, i)),
    reached: (name: PhaseName) => ms === Infinity || reached(ph, ms, name),
    /** a phase's length on the timeline (ms) */
    len: (name: PhaseName, i?: number) => (ph.find((x) => x.name === name && (i === undefined || x.i === i))?.ms || 0) * scale,
    /** the scene-local time a phase starts */
    t: (name: PhaseName, i?: number) => (st._start || 0) + (phaseStart(ph, name, i) ?? 0) * scale,
    /** has the procedure reached phase `name` of item `i`? */
    reachedI: (name: PhaseName, i: number) => ms === Infinity || ms >= (phaseStart(ph, name, i) ?? 0),
  };
}

type Proc = ReturnType<typeof procedure>;
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
/** The folder row a drop lands on: the compact row of the folder (or the root). */
const dropRow = (dir: string): string => chain(dirs, inFolder(dir)).pop() || '';
/** Where a file operation walks the explorer first: the folder a file is created in, or the old row. */
const fsTarget = (st: Step): string => (st._fs!.kind === 'create' ? inFolder(st._fs!.parent) : st._fs!.from!);

/**
 * The explorer through a file operation, phase by phase from where it was before the step: the walk to
 * the folder or the old row (locate), the drag (move: folders hovered on the way open, nothing closes),
 * then, once the file exists, the walk to its sorted row (walk). `pp` gives each phase's progress.
 */
function fsExplorer(s: State, st: Step, shown: string | null, pp: (n: PhaseName) => number): void {
  const op = st._fs!, file = st.file!, key = st._id || 0;
  const target = fsTarget(st);
  let top = walkTop(s.exTop, shown, target, pp('locate'), nowT);
  s.exScroll = { file: target, from: shown, p: pp('locate'), pick: 0, cursor: true, key };
  if (op.kind === 'move' && pp('drag') > 0) {
    top = walkTop(top, op.from!, inFolder(op.parent), pp('drag'), nowT, true);
    s.exScroll = { file: inFolder(op.parent), from: op.from!, p: pp('drag'), pick: 0, cursor: false, key, keep: true };
  }
  // a new folder opens once made, clicked open by the pointer (its New File box goes inside it)
  const made = op.dir ? (op.parent ? `${op.parent}/` : '') + op.dir : null;
  if (made && pp('dopen') > 0) {
    top = walkTop(top, inFolder(op.parent), inFolder(made), pp('dopen'), nowT);
    s.exScroll = { file: inFolder(made), from: inFolder(op.parent), p: pp('dopen'), pick: 0, cursor: true, key };
  }
  if (pp('walk') > 0) {
    const src = op.kind === 'rename' ? op.from! : inFolder(made ?? op.parent);
    const keepOpen = op.kind === 'move';
    top = walkTop(top, src, file, pp('walk'), nowT, keepOpen);
    s.exScroll = { file, from: src, p: pp('walk'), pick: pp('walk'), cursor: false, key, keep: keepOpen };
  }
  s.exTop = top;
}

/** Before the file opens: the explorer walk, then New File and the name typed / F2 and the new name / the drag, then the click on it. */
function applyFsOp(s: State, st: Step, pr: Proc): void {
  const op = st._fs!, file = st.file!;
  const { at } = pr;
  const shown = s.panes[s.active].file;
  const target = fsTarget(st);
  const moves = foldMoves(dirs, shown, target);
  const folds = moves.length - 1;
  const from = s.pointer?.to || s.pointerAt;
  const last: Anchor | null = folds > 0 ? { kind: 'ex', path: moves[folds - 1].path } : from;
  fsExplorer(s, st, shown, pr.pp);
  // the file being made, or the row being renamed / moved, is what the explorer lights (with its folders)
  s.exFocus = pr.reached('walk') || op.kind === 'create' ? file : op.from!;
  if (at.name === 'locate') {
    const { k, local, seg } = walkAt(walkPlan(dirs, shown, target), at.p);
    if (k < folds) {
      const row: Anchor = { kind: 'ex', path: moves[k].path };
      const prev: Anchor | null = k === 0 ? from : { kind: 'ex', path: moves[k - 1].path };
      s.pointer = local < seg.travel ? { from: prev, to: row, p: ease(local / seg.travel) } : { from: row, to: row, p: 1, click: local < seg.click };
    } else s.pointer = folds > 0 ? { from: last, to: last, p: 1 } : null;
    return;
  }
  // a name is typed one character per beat, after a short lead (the box opens, the caret blinks)
  const typingIn = (phase: PhaseName, text: string) => (pr.ms === Infinity ? Infinity : Math.max(0, pr.pp(phase) * nameMs(text) - 250));
  const typing = typingIn('name', op.name);
  const typed = (text: string, ms = typing) => text.slice(0, Math.min(text.length, Math.floor(ms / NAME_CHAR_MS)));
  if (op.kind === 'create') {
    const btn: Anchor = { kind: 'exNew' }, dirBtn: Anchor = { kind: 'exNewDir' };
    const made = op.dir ? (op.parent ? `${op.parent}/` : '') + op.dir : null;
    // the new folder's row, clicked open after Enter: New File starts from there
    const dmoves = made ? foldMoves(dirs, inFolder(op.parent), inFolder(made)) : [];
    const drow: Anchor = dmoves.length > 1 ? { kind: 'ex', path: dmoves[dmoves.length - 2].path } : dirBtn;
    if (op.dir && !pr.reached('travel')) {
      // New Folder first: its name (the new folders' path) typed, Enter, then the pointer clicks it open
      if (at.name === 'dtravel') { s.pointer = { from: last, to: dirBtn, p: ease(at.p) }; return; }
      if (at.name === 'dopen') {
        const { k, local, seg } = walkAt(walkPlan(dirs, inFolder(op.parent), inFolder(made!)), at.p);
        const dfolds = dmoves.length - 1;
        if (k < dfolds) {
          const row: Anchor = { kind: 'ex', path: dmoves[k].path };
          const prev: Anchor = k === 0 ? dirBtn : { kind: 'ex', path: dmoves[k - 1].path };
          s.pointer = local < seg.travel ? { from: prev, to: row, p: ease(local / seg.travel) } : { from: row, to: row, p: 1, click: local < seg.click };
        } else s.pointer = { from: drow, to: drow, p: 1 };
        s.pointerAt = drow;
        return;
      }
      s.pointer = { from: dirBtn, to: dirBtn, p: 1, click: at.name === 'dpress' };
      s.pointerAt = dirBtn;
      if (pr.reached('dname') && !pr.reached('dopen')) s.exEdit = { mode: 'mkdir', at: op.parent, text: typed(op.dir, typingIn('dname', op.dir)), sel: false };
      if (at.name === 'denter') s.keys = ['⏎'];
      return;
    }
    if (!pr.reached('walk')) {
      if (at.name === 'travel') { s.pointer = { from: op.dir ? drow : last, to: btn, p: ease(at.p) }; return; }
      s.pointer = { from: btn, to: btn, p: 1, click: at.name === 'press' };
      s.pointerAt = btn;
      if (pr.reached('name')) s.exEdit = { mode: 'create', at: made ?? op.parent, text: typed(op.name), sel: false };
      if (at.name === 'enter') s.keys = ['⏎'];
      return;
    }
  }
  const old: Anchor = { kind: 'ex', path: op.from! };
  const now: Anchor = { kind: 'ex', path: file };
  if (op.kind !== 'create' && !pr.reached('walk')) {
    if (at.name === 'travel') { s.pointer = { from: last, to: old, p: ease(at.p) }; return; }
    if (op.kind === 'rename') {
      s.pointer = { from: old, to: old, p: 1, click: at.name === 'select' };
      if (pr.reached('key')) {
        // F2 selects the old name; the first character typed replaces it
        const over = pr.reached('name') && typing >= NAME_CHAR_MS;
        s.exEdit = { mode: 'rename', at: op.from!, text: over ? typed(op.name) : baseName(op.from!), sel: !over };
        if (at.name === 'key') s.keys = ['F2'];
        if (at.name === 'enter') { s.keys = ['⏎']; s.exEdit.text = op.name; }
      }
      return;
    }
    const drop: Anchor = { kind: 'ex', path: dropRow(op.parent) };
    s.exDrag = { path: op.from!, to: dropRow(op.parent), p: pr.pp('drag') };
    s.pointer = at.name === 'grab' ? { from: old, to: old, p: 1, click: true } : { from: old, to: drop, p: glide(pr.pp('drag')), click: at.name === 'drop' };
    s.pointerAt = drop;
    return;
  }
  // the file now sits in its place: the pointer waits where the operation ended while the explorer
  // follows the file, then goes to the new row and clicks it: the file opens because it is clicked
  const rest: Anchor = op.kind === 'create' ? { kind: 'exNew' } : op.kind === 'rename' ? old : { kind: 'ex', path: dropRow(op.parent) };
  s.pointerAt = rest;
  s.pointer = at.name === 'walk' ? { from: rest, to: rest, p: 1 } : at.name === 'reach' ? { from: rest, to: now, p: ease(at.p) } : { from: now, to: now, p: 1, click: at.name === 'click' };
}
/** After a file operation, the explorer rests where it ended (and a drag leaves the folders it opened open). */
function fsRest(s: State, st: Step, before: string | null): void {
  fsExplorer(s, st, before, () => 1);
}

/** Opening a file: separate, sequential events (see openPhases): locate, travel, press, beat, swap, walk, land, reveal. */
function applyOpen(s: State, st: Step, pi: number, p: number, dur: number): void {
  const pane = s.panes[pi];
  const pr = procedure(st, p, dur);
  const { ph, ms, at } = pr;
  const kind = st._openKind || 'tree';
  const file = st.file!;
  const key = st._id || 0;
  if (kind === 'tree' && st._fs && !pr.reached('swap')) return applyFsOp(s, st, pr);
  if (kind !== 'same' && !pr.reached('swap')) {
    const target: Anchor = kind === 'tree' ? { kind: 'ex', path: file } : { kind: 'tab', pane: pi, file };
    const from = s.pointer?.to || s.pointerAt;
    // from the file the explorer shows now (the active pane's), through its folders, to this one:
    // the pointer clicks each folder on the way (shared/tree-path foldMoves, timed by walkPlan)
    let last: Anchor | null = from;
    if (kind === 'tree') {
      const shown = s.panes[s.active].file;
      const moves = foldMoves(dirs, shown, file);
      const folds = moves.length - 1;
      if (folds > 0) last = { kind: 'ex', path: moves[folds - 1].path };
      s.exFocus = file;
      s.exScroll = { file, from: shown, p: pr.pp('locate'), pick: at.name === 'press' ? ease(at.p) : pr.reached('beat') ? 1 : 0, cursor: true, key };
      s.exTop = walkTop(s.exTop, shown, file, s.exScroll.p, nowT);
      if (at.name === 'locate') {
        const { k, local, seg } = walkAt(walkPlan(dirs, shown, file), at.p);
        if (k < folds) {
          const row: Anchor = { kind: 'ex', path: moves[k].path };
          const prev: Anchor | null = k === 0 ? from : { kind: 'ex', path: moves[k - 1].path };
          s.pointer = local < seg.travel ? { from: prev, to: row, p: ease(local / seg.travel) } : { from: row, to: row, p: 1, click: local < seg.click };
        } else s.pointer = folds > 0 ? { from: last, to: last, p: 1 } : null; // the file's row scrolls into view
        return;
      }
    }
    if (at.name === 'travel') s.pointer = { from: last, to: target, p: ease(at.p) };
    else s.pointer = { from: target, to: target, p: 1, click: at.name === 'press' };
    if (st._side) {
      // Open to the Side: ⌥ held for the click, then a second group slides in beside the first
      if ((at.name === 'travel' && at.p > 0.45) || at.name === 'press') { s.keys = ['⌥']; s.keysHint = t('pointer.click'); }
      if (pr.reached('split')) { s.layout = 'columns'; s.split = pr.pp('split'); s.toast = t('split.open', { file: file.slice(file.lastIndexOf('/') + 1) }); s.toastAt = pr.t('split'); }
    }
    return; // nothing opens before the click
  }
  if (kind !== 'same') {
    const target: Anchor = kind === 'tree' ? { kind: 'ex', path: file } : { kind: 'tab', pane: pi, file };
    s.pointer = at.name === 'swap' ? { from: target, to: target, p: 1, fade: true } : null;
    s.pointerAt = target;
  }
  s.exFocus = null;
  const before = s.panes[s.active].file;
  showFile(s, pi, file, st.view);
  if (st._side) { pane.why = st.label || null; s.toast = t('split.open', { file: file.slice(file.lastIndexOf('/') + 1) }); s.toastAt = pr.t('split'); }
  // the explorer: after a tree pick it rests where its walk ended (computed again in this frame, since a
  // frame is rebuilt from the scene's start); after a tab click it walks there over the swap and the walk
  if (kind === 'tree' && st._fs) fsRest(s, st, before);
  else if (kind === 'tree') s.exTop = walkTop(s.exTop, before, file, 1, nowT);
  if (kind === 'tab') {
    // over the swap and the walk after it, in the procedure's own time
    const span = ph.filter((x) => x.name === 'swap' || x.name === 'walk').reduce((a, x) => a + x.ms, 0) || 1;
    follow(s, before, file, ms === Infinity ? 1 : clamp((ms - (phaseStart(ph, 'swap') || 0)) / span, 0, 1), key);
  }
  if (st.diff) Object.assign(pane.diff, st.diff);
  if (kind !== 'same') pane.enter = { key, p: pr.pp('swap') };
  if (st._r) {
    // a new file opens already at its target; within the same file, the editor scrolls there
    if (kind === 'same') setScroll(pane, st._r, 'center', glide(pr.pp('land')), pr.len('land'));
    else setScroll(pane, st._r, 'center', 1);
  } else if (st._first && kind !== 'same') setScroll(pane, st._first, 'center', 1);
  if (st._reveal) {
    // the changes are held back from the moment the file appears, never shown and then taken away
    const rp = pr.pp('reveal');
    if (rp < 1) s.reveal = { file, p: rp };
  }
}

export function apply(s: State, st: Step, p: number, dur: number): void {
  const pi = st._pane != null ? st._pane : st.pane != null ? (st.pane ? 1 : 0) : s.active;
  const pane = s.panes[pi];
  const key = st._id || 0;
  switch (st.do) {
    case 'open': return applyOpen(s, st, pi, p, dur);
    case 'close': {
      const i = pane.tabs.indexOf(st.file!);
      if (i >= 0) pane.tabs.splice(i, 1);
      if (pane.file === st.file) { pane.file = null; const last = pane.tabs[pane.tabs.length - 1]; if (last) showFile(s, pi, last); }
      if (pi === 1 && !pane.tabs.length) { s.layout = 'single'; s.split = 0; s.active = 0; pane.why = null; }
      return;
    }
    case 'layout': {
      const pr = procedure(st, p, dur);
      const before = s.panes[s.active].file;
      if (st.mode === 'columns') { s.layout = 'columns'; s.split = pr.pp('split'); return; }
      if (st._close) {
        // the comparison is over: the pointer clicks the right group's tab closed, and the group slides out
        const p1 = s.panes[1];
        const tab: Anchor | null = p1.file ? { kind: 'tabClose', pane: 1, file: p1.file } : null;
        if (!pr.reached('collapse')) {
          if (tab) s.pointer = pr.reached('click') ? { from: tab, to: tab, p: 1, click: pr.pp('click') < 1 } : { from: s.pointer?.to || s.pointerAt, to: tab, p: ease(pr.pp('travel')) };
          return;
        }
        s.pointer = null; s.pointerAt = null;
        s.active = 0;
        s.toast = t('split.close'); s.toastAt = pr.t('collapse');
        const cp = pr.pp('collapse');
        s.split = 1 - cp;
        if (cp >= 1) {
          s.layout = 'single'; s.split = 0;
          Object.assign(p1, { tabs: [], file: null, why: null, hl: [], notes: [], focus: null, flash: null, tokline: null, peek: null, trace: null });
        }
        if (s.panes[0].file) follow(s, before, s.panes[0].file, pr.pp('walk'), key);
        return;
      }
      s.layout = 'single'; s.split = 0; s.active = 0;
      if (s.panes[0].file) follow(s, before, s.panes[0].file, pr.pp('walk'), key);
      return;
    }
    case 'diffView': {
      if (st.mode === 'unified' || st.mode === 'split') pane.diff.mode = st.mode;
      if (st.algorithm) pane.diff.algorithm = st.algorithm;
      if (st.granularity) pane.diff.granularity = st.granularity;
      if (st.context !== undefined) pane.diff.context = st.context;
      if (st.whitespace) pane.diff.whitespace = st.whitespace;
      const f = pane.file ? IR.files[pane.file] : null;
      if (f && f.before != null && f.after != null) pane.view = 'diff';
      return;
    }
    case 'reveal': case 'highlight': case 'focus': case 'note': {
      // walk (if the file changes), scroll to the range, then mark it: the code is in place before it is marked
      const pr = procedure(st, p, dur);
      const before = s.panes[s.active].file;
      showFile(s, pi, st._file!, st._view);
      follow(s, before, st._file!, pr.pp('walk'), key);
      const r = st._r; if (!r) return;
      const mode = st.do === 'reveal' ? (st.align === 'top' ? 'top' : 'center') : st.do === 'focus' ? 'center' : 'ensure';
      if (st.reveal !== false) setScroll(pane, r, mode, glide(pr.pp('scroll')), pr.len('scroll'));
      if (!pr.reached('mark')) return;
      const t = pr.t('mark'), mp = pr.pp('mark');
      if (st.do === 'highlight') pane.hl.push({ ...r, tone: st.tone || 'focus', label: st.label || null, p: mp, key, t });
      if (st.do === 'focus') pane.focus = { ...r, p: mp, t };
      if (st.do === 'note') pane.notes.push({ side: r.side, line: r.to, text: st.text || '', tone: st.tone || 'info', key, t });
      return;
    }
    case 'type': case 'replay': {
      const pr = procedure(st, p, dur);
      const before = s.panes[s.active].file;
      showFile(s, pi, st._file!, st._view);
      follow(s, before, st._file!, pr.pp('walk'), key);
      const r = st._r; if (!r) return;
      const tp = pr.pp('type');
      let e = s.typing.find((x) => x.key === st._id);
      if (!e) { e = { key, file: st._file!, side: r.side, from: r.from, to: r.to, p: 0, t: 0, mode: 'type' }; s.typing.push(e); }
      e.t = pr.t('type'); e.p = tp; e.mode = st._mode || 'type'; e.dp = st._dp;
      // a block or a short hunk: the editor brings its place into view first (BLOCK_LEAD of the
      // typing part, see decorate), then it opens; a scroll squeezed into a few frames reads as a jump
      const share = e.mode === 'block' ? 0.4 : 0.15;
      if (e.mode === 'block' || r.to - r.from < 6) setScroll(pane, r, 'ensure', glide(clamp(tp / share, 0, 1)), pr.len('type') * share);
      else {
        // follow the line being written, like an editor keeping the caret in view
        const dp = st._dp || 0;
        const wp = clamp((tp - dp) / Math.max(0.01, 1 - dp), 0, 1);
        const cur = Math.round(r.from + (r.to - r.from) * wp);
        setScroll(pane, { side: r.side, from: Math.max(r.from, cur - 1), to: cur }, tp < dp ? 'ensure' : 'follow', 1);
      }
      return;
    }
    case 'unfocus': for (const pn of st.pane != null ? [pane] : s.panes) pn.focus = null; return;
    case 'clear': for (const pn of st.pane != null ? [pane] : s.panes) { pn.hl = []; pn.notes = []; pn.focus = null; } return;
    case 'goto': {
      // walk to the call site's file, scroll to it, point at the token, hold Cmd, click, jump (walk), land, flash
      const fr = st._from, to = st._to;
      if (!fr || !to || !fr.line || !fr.side) return;
      const pr = procedure(st, p, dur);
      const before = s.panes[s.active].file;
      const call: LineRange = { side: fr.side, from: fr.line, to: fr.line };
      showFile(s, pi, fr.file);
      follow(s, before, fr.file, pr.pp('walk'), key);
      setScroll(pane, call, 'ensure', glide(pr.pp('scroll')), pr.len('scroll'));
      const anchor: CodeAnchor = { kind: 'code', pane: pi, side: fr.side, line: fr.line, token: st.from?.token };
      if (!pr.reached('jump')) {
        pane.focus = null; // never Cmd+Click into dimmed code
        if (pr.reached('scroll')) pane.hl.push({ ...call, tone: 'focus', label: null, p: 1, key: `g${st._id}` });
        const from = s.pointer?.to || s.pointerAt;
        s.pointer = !pr.reached('point') ? null : { from, to: anchor, p: ease(pr.pp('point')), click: pr.reached('click') };
        if (pr.reached('cmd')) { s.keys = ['⌘']; s.keysHint = t('pointer.click'); pane.tokline = anchor; }
        return;
      }
      pane.focus = null;
      const tp = s.panes[to.pane];
      const same = tp.file === to.file;
      showFile(s, to.pane, to.file, to.view);
      // to the side: the second group slides in, then the definition lands in it
      if (st._side) s.split = pr.pp('split');
      follow(s, fr.file, to.file, pr.pp('jump'), key);
      const r: LineRange = { side: to.side || 'after', from: to.from || 1, to: to.to || to.from || 1 };
      setScroll(tp, r, 'center', same ? glide(pr.pp('land')) : 1, pr.len('land'));
      tp.hl.push({ ...r, tone: 'focus', label: null, p: pr.pp('land'), key, t: pr.t('land') });
      // the flash fades over everything after the click
      const j0 = phaseStart(pr.ph, 'jump') || 0, rest = phasesMs(pr.ph) - j0 || 1;
      tp.flash = { side: r.side, from: r.from, to: r.from, key: `${st._id}`, p: pr.ms === Infinity ? 1 : clamp((pr.ms - j0) / rest, 0, 1) };
      s.toast = t('goto.toast', { token: st.from?.token || '', to: `${to.file}:${to.line}` }); s.toastAt = pr.t('jump');
      // a drill-down: the line it left stays named on screen until the viewer is brought back to it
      if (st._detour) s.detour = { file: fr.file, line: fr.line, side: fr.side };
      s.pointerAt = anchor;
      s.pointer = !pr.reached('flash') ? { from: anchor, to: anchor, p: 1, fade: true } : null;
      s.keys = null; s.keysHint = null;
      return;
    }
    case 'peek': {
      // ⌘-hover: the pointer rests on the token, ⌘ is held, and the definition opens in a hover over the
      // line, which stays where it is (the line is never left, so nothing has to be found again)
      const fr = st._from, pk = st._peek;
      if (!fr || !fr.line || !fr.side || !pk) return;
      const pr = procedure(st, p, dur);
      const before = s.panes[s.active].file;
      const call: LineRange = { side: fr.side, from: fr.line, to: fr.line };
      showFile(s, pi, fr.file);
      follow(s, before, fr.file, 1, key);
      setScroll(pane, call, 'ensure', glide(pr.pp('scroll')), pr.len('scroll'));
      const anchor: CodeAnchor = { kind: 'code', pane: pi, side: fr.side, line: fr.line, token: st.from?.token };
      // the line stays lit (and the sentence about the definition sits with it)
      if (pr.reached('point')) pane.hl.push({ ...call, tone: 'focus', label: null, p: 1, key: `p${st._id}`, t: pr.t('point') });
      if (!pr.reached('point')) return;
      s.pointer = { from: s.pointer?.to || s.pointerAt, to: anchor, p: ease(pr.pp('point')) };
      s.pointerAt = anchor;
      if (pr.reached('cmd')) { s.keys = ['⌘']; s.keysHint = t('pointer.hover'); pane.tokline = anchor; }
      if (pr.reached('hover')) pane.peek = { file: pk.file, side: pk.side, from: pk.from, to: pk.to, mark: pk.mark || null, at: anchor, p: pr.pp('hover'), mp: pr.pp('mark'), key };
      return;
    }
    case 'trace': {
      // a debugger paused in the function: the line it is on, Step Over to the next stop (the stop moves
      // there, the editor keeps it in view), the values beside the lines, then what the call returns
      const frames = st._frames || [];
      const pr = procedure(st, p, dur);
      const before = s.panes[s.active].file;
      showFile(s, pi, st._file!, st._view);
      follow(s, before, st._file!, pr.pp('walk'), key);
      if (!pr.reached(st.call ? 'head' : 'step')) return;
      let tr = pane.trace;
      if (st.call || !tr || tr.session !== st._session) {
        tr = pane.trace = { session: st._session || 0, call: st.call || null, headP: 0, end: 0, cur: null, prev: null, q: 1, stepping: false, vals: [], ret: null };
        if (st._r) pane.focus = { ...st._r, p: pr.pp('head'), t: pr.t('head') };
      }
      if (st.call) tr.headP = pr.pp('head');
      const known = new Map<string, string>();
      for (const row of tr.vals) for (const it of row.items) known.set(it.k, it.v);
      tr.stepping = false;
      frames.forEach((fr, i) => {
        if (!pr.reachedI('step', i)) return;
        const sp = pr.pp('step', i);
        tr!.prev = tr!.cur; tr!.cur = { side: fr.side, line: fr.line }; tr!.q = glide(sp);
        // the first stop of a session is where it pauses; every later one is reached by Step Over
        tr!.stepping = sp < 1 && !(i === 0 && st.call);
        setScroll(pane, { side: fr.side, from: fr.line, to: fr.line }, 'ensure', glide(sp), pr.len('step', i));
        if (!pr.reachedI('mark', i)) return;
        let row = tr!.vals.find((v) => v.side === fr.side && v.line === fr.line);
        if (!row) tr!.vals.push((row = { side: fr.side, line: fr.line, items: [] }));
        const at = pr.t('mark', i);
        for (const [k, v] of fr.vars) {
          const was = known.get(k);
          const item: TraceValue = { k, v, t: at, changed: was !== undefined && was !== v };
          const j = row.items.findIndex((x) => x.k === k);
          if (j >= 0) row.items[j] = item; else row.items.push(item);
          known.set(k, v);
        }
      });
      if (st.returns != null && pr.reached('ret')) {
        const last = frames[frames.length - 1];
        if (last) {
          tr.ret = { side: last.side, line: last.line, text: st.returns, t: pr.t('ret') };
          if (!tr.vals.some((r) => r.side === last.side && r.line === last.line)) tr.vals.push({ side: last.side, line: last.line, items: [] });
        }
        // the call has returned: the session ends (the stop and the toolbar go; the values stay to be read)
        tr.end = clamp((pr.pp('ret') - 0.6) / 0.4, 0, 1);
      }
      return;
    }
    case 'refs': case 'impact': {
      // the list comes in; then per item: the pointer goes to its entry, clicks, the editor and the
      // explorer move to it (as long as the move needs), it lights up, and stays until the next click
      const items = st._items || [];
      const pr = procedure(st, p, dur);
      const k = pr.at.name === 'head' || pr.at.i === undefined ? -1 : pr.at.i;
      s.refs = { kind: st.do, symbol: st.symbol, title: st.title || null, change: st.change, items, active: k };
      if (k < 0) return;
      const show = (j: number, sp: number, hp: number, wp: number) => {
        const x = items[j];
        const before = s.panes[pi].file;
        const pn = showFile(s, pi, x.file, x.view);
        follow(s, before, x.file, wp, key);
        const r: LineRange = { side: x.side, from: x.line, to: x.line };
        setScroll(pn, r, 'center', sp, pr.len('move', j));
        pn.hl = pn.hl.filter((h) => !h.ref);
        pn.hl.push({ ...r, tone: x.effect ? EFFECT_TONE[x.effect] : 'info', ref: true, label: x.label, p: hp, key: `${st._id}:${j}` });
      };
      // every earlier item as it ended, in order: the next one moves on from exactly there
      for (let j = 0; j < k; j++) show(j, 1, 1, 1);
      const last = k === items.length - 1;
      s.pointer = last && pr.reached('hold') && pr.at.i === k && pr.at.name === 'hold' ? null
        : { from: k > 0 ? { kind: 'ref', index: k - 1 } : s.pointerAt, to: { kind: 'ref', index: k }, p: ease(pr.pp('point', k)), click: pr.pp('click', k) > 0 && pr.pp('click', k) < 1 };
      if (pr.pp('click', k) < 1) return;
      // the explorer's walk has its own curve per segment: it takes the time linearly
      const mp = pr.pp('move', k);
      show(k, glide(mp), pr.pp('mark', k), mp);
      return;
    }
    case 'delete': {
      // the pointer goes to the row, right click, Delete in the menu, the row folds away, its tab closes
      const file = st.file!;
      const pr = procedure(st, p, dur);
      const at = pr.at;
      const row: Anchor = { kind: 'ex', path: file }, item: Anchor = { kind: 'exMenu' };
      if (!pr.reached('remove')) {
        s.exFocus = file;
        if (at.name === 'travel') { s.pointer = { from: s.pointer?.to || s.pointerAt, to: row, p: ease(at.p) }; return; }
        s.exMenu = { path: file, hot: pr.reached('press') || (at.name === 'aim' && at.p > 0.8) };
        s.pointer = !pr.reached('aim') ? { from: row, to: row, p: 1, click: at.name === 'menu' } : { from: row, to: item, p: ease(pr.pp('aim')), click: at.name === 'press' };
        return;
      }
      s.pointerAt = item;
      s.pointer = null;
      s.exRemove = { path: file, p: pr.pp('remove') };
      if (pr.reached('close')) {
        const i = pane.tabs.indexOf(file);
        if (i >= 0) pane.tabs.splice(i, 1);
        if (pane.file === file) { pane.file = null; const last = pane.tabs[pane.tabs.length - 1]; if (last) showFile(s, pi, last); }
      }
      return;
    }
    case 'back': {
      // Go Back (⌃−): to the line the drill-down left. That line is lit and flashes as it lands, so the
      // place the explanation resumes is found at once, with what was just learned to apply to it.
      const to = st._to;
      if (!to || !to.line || !to.side) return;
      const pr = procedure(st, p, dur);
      if (!pr.reached('jump')) { s.keys = ['⌃', '−']; s.pointer = null; return; }
      const before = s.panes[s.active].file;
      const tp = s.panes[to.pane];
      const same = tp.file === to.file;
      showFile(s, to.pane, to.file, to.view);
      follow(s, before, to.file, 1, key);
      const r: LineRange = { side: to.side, from: to.line, to: to.line };
      setScroll(tp, r, 'center', same ? glide(pr.pp('land')) : 1, pr.len('land'));
      tp.hl.push({ ...r, tone: 'focus', label: null, p: pr.pp('land'), key, t: pr.t('land') });
      const j0 = phaseStart(pr.ph, 'jump') || 0, rest = phasesMs(pr.ph) - j0 || 1;
      tp.flash = { side: r.side, from: r.from, to: r.from, key: `${st._id}`, p: pr.ms === Infinity ? 1 : clamp((pr.ms - j0) / rest, 0, 1) };
      s.toast = t('back.toast', { to: `${to.file.slice(to.file.lastIndexOf('/') + 1)}:${to.line}` }); s.toastAt = pr.t('jump');
      s.detour = null;
      return;
    }
    case 'graph': {
      const title = st.title || t('graph.title');
      if (st.hide) { s.graph = null; if (st.unpin) s.map = null; return; }
      if (st.nodes) {
        s.graph = { nodes: st.nodes, edges: st.edges || [], title, size: st.size || 'full', highlight: st.highlight || [], key };
        if (st.pin !== false) s.map = { nodes: st.nodes, edges: st.edges || [], title, key };
      } else if (s.graph) s.graph = { ...s.graph, highlight: st.highlight || [] };
      return;
    }
    case 'say': s.say = st.text || ''; return;
    default: return;
  }
}

const snapshots: State[] = [];
/** Forget computed scene starts (the explorer's size or filter changed, and its scroll with them). */
export function resetSnapshots(): void { snapshots.length = 0; }
/** The time the steps are being applied at (the explorer hides files that do not exist yet). */
let nowT = 0;
/** Apply a step, then let the explorer settle on the file in view unless it is walking to one. */
/** Steps that leave the screen as it is: a hover stays open over them. */
const STILL_STEPS = new Set<Step['do']>(['say', 'wait', 'graph', 'clear', 'unfocus']);
function step(s: State, st: Step, p: number, dur: number): void {
  const before = s.panes[s.active].file;
  // a hover closes when the pointer moves on, which the next step that does something makes it do
  if (st.do !== 'peek' && !STILL_STEPS.has(st.do)) for (const pn of s.panes) if (pn.peek) { pn.peek = null; pn.tokline = null; s.keys = null; s.keysHint = null; s.pointer = null; }
  apply(s, st, p, dur);
  // a step that changed the file in view without walking the explorer (none the compiler knows of):
  // the explorer goes along anyway, at once
  const now = s.panes[s.active].file;
  if (now && before !== now && s.exScroll?.key !== (st._id || 0)) follow(s, before, now, 1, st._id || 0);
  if (!s.exScroll) s.exTop = settleTop(s.exTop, s.exFocus || s.panes[s.active].file, nowT, s.exFocus);
}
function sceneStartState(k: number): State {
  if (snapshots[k]) return snapshots[k];
  let s: State;
  if (k === 0) s = initState();
  else {
    s = clone(sceneStartState(k - 1));
    const sc = scenes[k - 1];
    for (const t of sc.timed) { nowT = sc.t0 + t.start + t.dur; step(s, t.st, 1, t.dur); }
  }
  resetTransient(s);
  // a scene starts where the last one left the editor: the target keeps the targets before it, so
  // where it rests is computed the same way at the start of this scene as at the end of the last
  for (const p of s.panes) if (p.scroll) p.scroll.p = 1;
  snapshots[k] = s;
  return s;
}

export function stateAt(T: number): State {
  const k = sceneAt(T);
  const sc = scenes[k];
  const s = clone(sceneStartState(k));
  const t = T - sc.t0;
  // An edit this scene replays later is "not written yet" until then: its added lines
  // are hidden and its removed lines look unchanged.
  for (const x of sc.timed) {
    const r = x.st._r;
    if (x.st.do === 'type' && r && t < x.start) s.typing.push({ key: x.st._id || 0, file: x.st._file!, side: r.side, from: r.from, to: r.to, p: 0, t: x.start, mode: 'type', dp: x.st._dp });
  }
  for (const r of replays) {
    if (r.g <= T || !r.st._r) continue;
    const sp = fileSpan[r.file];
    if (sp && sp.from <= T + 1) s.typing.push({ key: r.st._id || 0, file: r.file, side: r.st._r.side, from: r.st._r.from, to: r.st._r.to, p: 0, t: r.g, mode: r.st._mode || 'lines', dp: r.st._dp });
  }
  for (const x of sc.timed) {
    if (t < x.start) continue;
    nowT = T;
    step(s, x.st, x.dur ? clamp((t - x.start) / x.dur, 0, 1) : 1, x.dur);
  }
  nowT = T;
  if (!s.exScroll) s.exTop = settleTop(s.exTop, s.exFocus || s.panes[s.active].file, T, s.exFocus);
  s.scene = k;
  s.sceneP = clamp(t / sc.duration, 0, 1);
  s.sceneT = t;
  s.bridge = t < sc.lead ? { p: t / sc.lead } : null;
  // orientation follows what is on screen: a tour scene's file is "current" once it opens
  // (a tour scene that opens with a preview of its explanation is current from its first frame: the card announces it)
  const early = sc.auto && k > 0 && sc.swapAt > 0 && !sc.lead;
  s.shown = early && t < sc.swapAt ? k - 1 : k;
  // the outline changes with the screen change (one event), never during the replay that follows
  s.guideScene = k > 0 && ((early && t < sc.swapAt) || (!sc.auto && t < sc.swapEnd)) ? k - 1 : k;
  return s;
}
