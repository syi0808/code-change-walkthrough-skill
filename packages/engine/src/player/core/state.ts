// The walkthrough state is a pure function of timeline time:
//   state(T) = reduce(snapshot at scene start, steps started by T, their progress)
// so play, pause, scrub, speed and scene jumps all just pick a T.
import { openPhases, phaseAt, reached } from '../../shared/timing.ts';
import type { DiffSettings, GraphEdge, GraphNode, LineRange, RefItem, ReplayMode, Side, Step, View } from '../../ir/types.ts';
import { clamp, clone, ease, IR, T_ } from './env.ts';
import { fileSpan, replays, sceneAt, scenes } from './timeline.ts';

export interface ScrollTarget { side: Side; from?: number; to?: number; line?: number }
export interface Scroll { to: ScrollTarget; mode: 'center' | 'top' | 'ensure' | 'follow'; p: number; prev: Scroll | null }
export interface Hl extends LineRange { tone: string; label: string | null; p: number; key: string | number; t?: number; ref?: boolean }
export interface NoteState { side: Side; line: number; text: string; tone: string; key: number; t: number }
export interface CodeAnchor { kind: 'code'; pane: number; side: Side; line: number; token?: string }
export type Anchor = { kind: 'ex'; path: string } | { kind: 'tab'; pane: number; file: string } | { kind: 'ref'; index: number } | CodeAnchor;
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
  toast: string | null;
  refs: { symbol?: string; title: string | null; items: RefItem[]; active: number } | null;
  graph: GraphState | null;
  map: GraphState | null;
  say: string;
  typing: Typing[];
  /** A file being picked in the explorer. */
  exFocus: string | null;
  /** The explorer scrolling that file into view: progress of the "locate" phase. */
  exScroll: { file: string; p: number; key: number } | null;
  reveal: { file: string; p: number } | null;
  scene: number;
  sceneP: number;
  sceneT: number;
  /** The scene the orientation shows: a tour scene takes over when its file opens, not before. */
  shown: number;
  /** The scene the outline panel highlights: it changes together with the screen change, not during a replay. */
  guideScene: number;
  bridge: { p: number } | null;
}

export const DIFF_DEFAULT: DiffSettings = { mode: 'unified', algorithm: 'patience', granularity: 'word', context: 3, whitespace: 'collapse' };
const newPane = (): PaneState => ({ tabs: [], file: null, view: 'after', diff: { ...DIFF_DEFAULT }, scroll: null, mem: {}, hl: [], focus: null, notes: [], flash: null, tokline: null, enter: null });
const initState = (): State => ({ layout: 'single', active: 0, panes: [newPane(), newPane()], pointer: null, pointerAt: null, keys: null, toast: null, refs: null, graph: null, map: null, say: '', typing: [], exFocus: null, exScroll: null, reveal: null, scene: 0, sceneP: 0, sceneT: 0, shown: 0, guideScene: 0, bridge: null });

function resetTransient(s: State): void {
  for (const p of s.panes) { p.hl = []; p.focus = null; p.notes = []; p.flash = null; p.tokline = null; p.enter = null; }
  if (s.pointer?.to) s.pointerAt = s.pointer.to;
  s.pointer = null; s.keys = null; s.toast = null; s.refs = null; s.graph = null; s.say = ''; s.typing = []; s.exFocus = null; s.exScroll = null; s.reveal = null;
}

export function setScroll(pane: PaneState, to: ScrollTarget, mode: Scroll['mode'], p: number): void {
  const prev = pane.scroll;
  if (prev) prev.prev = prev.mode === 'ensure' && prev.prev ? { ...prev.prev, prev: null } : null;
  pane.scroll = { to, mode, p, prev: prev && prev.to ? prev : null };
  if (pane.file) pane.mem[pane.file] = to;
}

const defaultView = (file: string): View => {
  const f = IR.files[file];
  return !f || f.status === 'context' || f.status === 'added' ? 'after' : f.status === 'deleted' ? 'before' : 'diff';
};
export function showFile(s: State, pi: number, file: string, view?: View): PaneState {
  const pane = s.panes[pi];
  if (pi === 1) s.layout = 'columns';
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

/** Opening a file: separate, sequential events (see openPhases): locate, travel, press, beat, swap, land, reveal. */
function applyOpen(s: State, st: Step, pi: number, p: number, dur: number): void {
  const pane = s.panes[pi];
  const ph = openPhases(st);
  const ms = p >= 1 ? Infinity : p * dur;
  const at = phaseAt(ph, ms);
  const kind = st._openKind || 'tree';
  const file = st.file!;
  if (kind !== 'same' && !reached(ph, ms, 'swap')) {
    const target: Anchor = kind === 'tree' ? { kind: 'ex', path: file } : { kind: 'tab', pane: pi, file };
    const from = s.pointer?.to || s.pointerAt;
    if (kind === 'tree') { s.exFocus = file; s.exScroll = { file, p: at.name === 'locate' ? ease(at.p) : 1, key: st._id || 0 }; }
    if (at.name === 'locate') s.pointer = null; // only the explorer moves; the pointer waits
    else if (at.name === 'travel') s.pointer = { from, to: target, p: ease(at.p) };
    else s.pointer = { from: target, to: target, p: 1, click: at.name === 'press' };
    return; // nothing opens before the click
  }
  if (kind !== 'same') {
    const target: Anchor = kind === 'tree' ? { kind: 'ex', path: file } : { kind: 'tab', pane: pi, file };
    s.pointer = at.name === 'swap' ? { from: target, to: target, p: 1, fade: true } : null;
    s.pointerAt = target;
  }
  s.exFocus = null;
  showFile(s, pi, file, st.view);
  if (st.diff) Object.assign(pane.diff, st.diff);
  if (kind !== 'same') pane.enter = { key: st._id || 0, p: at.name === 'swap' ? at.p : 1 };
  if (st._r) {
    // a new file opens already at its target; within the same file, the editor scrolls there
    if (kind === 'same') setScroll(pane, st._r, 'center', at.name === 'land' ? ease(at.p) : reached(ph, ms, 'land') ? 1 : 0);
    else setScroll(pane, st._r, 'center', 1);
  } else if (st._first && kind !== 'same') setScroll(pane, st._first, 'center', 1);
  if (st._reveal) {
    const rp = at.name === 'reveal' ? at.p : reached(ph, ms, 'reveal') && ms !== Infinity && at.i < ph.length ? 0 : 1;
    if (rp < 1) s.reveal = { file, p: at.name === 'reveal' ? at.p : 0 };
  }
}

export function apply(s: State, st: Step, p: number, dur: number): void {
  const pi = st._pane != null ? st._pane : st.pane != null ? (st.pane ? 1 : 0) : s.active;
  const pane = s.panes[pi];
  switch (st.do) {
    case 'open': return applyOpen(s, st, pi, p, dur);
    case 'close': {
      const i = pane.tabs.indexOf(st.file!);
      if (i >= 0) pane.tabs.splice(i, 1);
      if (pane.file === st.file) { pane.file = null; const last = pane.tabs[pane.tabs.length - 1]; if (last) showFile(s, pi, last); }
      if (pi === 1 && !pane.tabs.length) { s.layout = 'single'; s.active = 0; }
      return;
    }
    case 'layout': s.layout = st.mode === 'columns' ? 'columns' : 'single'; if (st.mode === 'single') s.active = 0; return;
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
      showFile(s, pi, st._file!, st._view);
      const r = st._r; if (!r) return;
      const t = st._start || 0;
      // a highlight sweeps in line by line over the first 60% of the step
      if (st.do === 'highlight') pane.hl.push({ ...r, tone: st.tone || 'focus', label: st.label || null, p: clamp(p / 0.6, 0, 1), key: st._id || 0, t });
      if (st.do === 'focus') pane.focus = { ...r, p: clamp(p / 0.5, 0, 1), t };
      if (st.do === 'note') pane.notes.push({ side: r.side, line: r.to, text: st.text || '', tone: st.tone || 'info', key: st._id || 0, t });
      const mode = st.do === 'reveal' ? (st.align === 'top' ? 'top' : 'center') : st.do === 'focus' ? 'center' : 'ensure';
      if (st.reveal !== false) setScroll(pane, r, mode, ease(clamp(p / 0.7, 0, 1)));
      return;
    }
    case 'type': case 'replay': {
      showFile(s, pi, st._file!, st._view);
      const r = st._r; if (!r) return;
      let e = s.typing.find((x) => x.key === st._id);
      if (!e) { e = { key: st._id || 0, file: st._file!, side: r.side, from: r.from, to: r.to, p: 0, t: 0, mode: 'type' }; s.typing.push(e); }
      e.t = st._start || 0; e.p = p; e.mode = st._mode || 'type'; e.dp = st._dp;
      if (e.mode === 'block' || r.to - r.from < 6) setScroll(pane, r, 'ensure', ease(clamp(p / 0.15, 0, 1)));
      else {
        // follow the line being written, like an editor keeping the caret in view
        const dp = st._dp || 0;
        const wp = clamp((p - dp) / Math.max(0.01, 1 - dp), 0, 1);
        const cur = Math.round(r.from + (r.to - r.from) * wp);
        setScroll(pane, { side: r.side, from: Math.max(r.from, cur - 1), to: cur }, p < dp ? 'ensure' : 'follow', 1);
      }
      return;
    }
    case 'unfocus': for (const pn of st.pane != null ? [pane] : s.panes) pn.focus = null; return;
    case 'clear': for (const pn of st.pane != null ? [pane] : s.panes) { pn.hl = []; pn.notes = []; pn.focus = null; } return;
    case 'goto': {
      const fr = st._from, to = st._to;
      if (!fr || !to || !fr.line || !fr.side) return;
      // scroll to the call site, then move the pointer, then hold Cmd, then click, then jump
      const SCROLL = 0.12, MOVE = 0.34, CLICK = 0.48, JUMP = 0.56;
      if (p < JUMP) {
        showFile(s, pi, fr.file);
        pane.focus = null; // never Cmd+Click into dimmed code
        if (p > 0.06) pane.hl.push({ side: fr.side, from: fr.line, to: fr.line, tone: 'focus', label: null, p: 1, key: `g${st._id}` });
        setScroll(pane, { side: fr.side, from: fr.line, to: fr.line }, 'ensure', ease(clamp(p / SCROLL, 0, 1)));
        const anchor: CodeAnchor = { kind: 'code', pane: pi, side: fr.side, line: fr.line, token: st.from?.token };
        const from = s.pointer?.to || s.pointerAt;
        if (p < SCROLL) s.pointer = null;
        else s.pointer = { from, to: anchor, p: ease(clamp((p - SCROLL) / (MOVE - SCROLL), 0, 1)), click: p > CLICK };
        if (p >= MOVE) { s.keys = ['⌘']; pane.tokline = anchor; }
      } else {
        pane.tokline = null;
        const tp = s.panes[to.pane];
        const same = tp.file === to.file;
        showFile(s, to.pane, to.file, to.view);
        const r: LineRange = { side: to.side || 'after', from: to.from || 1, to: to.to || to.from || 1 };
        setScroll(tp, r, 'center', same ? ease(clamp((p - JUMP) / 0.25, 0, 1)) : 1);
        tp.hl.push({ ...r, tone: 'focus', label: null, p: clamp((p - JUMP) / 0.3, 0, 1), key: st._id || 0 });
        tp.flash = { side: r.side, from: r.from, to: r.from, key: `${st._id}`, p: clamp((p - JUMP) / (1 - JUMP), 0, 1) };
        s.toast = `${T_('정의로 이동', 'Go to Definition')}  ${st.from?.token || ''} → ${to.file}:${to.line}`;
        if (s.pointer?.to) s.pointerAt = s.pointer.to;
        s.pointer = p < 0.7 && s.pointer ? { ...s.pointer, p: 1, click: false, fade: true } : null;
        s.keys = null;
      }
      return;
    }
    case 'refs': {
      const items = st._items || [];
      const n = items.length;
      const head = 700 / ((st.ms || 700) + 1300 * n);
      const k = p < head ? -1 : Math.min(n - 1, Math.floor(((p - head) / (1 - head)) * n));
      s.refs = { symbol: st.symbol, title: st.title || null, items, active: k };
      if (k < 0) return;
      // per item: pointer to the list entry, click, then the editor scrolls to it, then it lights up
      const it = items[k];
      const local = ((p - head) / (1 - head)) * n - k;
      const target: Anchor = { kind: 'ref', index: k };
      s.pointer = k === n - 1 && local > 0.7 ? null : { from: k > 0 ? { kind: 'ref', index: k - 1 } : s.pointerAt, to: target, p: ease(clamp(local / 0.2, 0, 1)), click: local > 0.2 && local < 0.3 };
      if (local < 0.3) return;
      const pn = showFile(s, pi, it.file, it.view);
      const r: LineRange = { side: it.side, from: it.line, to: it.line };
      setScroll(pn, r, 'center', ease(clamp((local - 0.3) / 0.3, 0, 1)));
      pn.hl = pn.hl.filter((h) => !h.ref);
      pn.hl.push({ ...r, tone: 'info', ref: true, label: it.label, p: clamp((local - 0.45) / 0.25, 0, 1), key: `${st._id}:${k}` });
      return;
    }
    case 'graph': {
      const title = st.title || T_('관계도', 'Relationships');
      if (st.hide) { s.graph = null; if (st.unpin) s.map = null; return; }
      if (st.nodes) {
        s.graph = { nodes: st.nodes, edges: st.edges || [], title, size: st.size || 'full', highlight: st.highlight || [], key: st._id || 0 };
        if (st.pin !== false) s.map = { nodes: st.nodes, edges: st.edges || [], title, key: st._id || 0 };
      } else if (s.graph) s.graph = { ...s.graph, highlight: st.highlight || [] };
      return;
    }
    case 'say': s.say = st.text || ''; return;
    default: return;
  }
}

const snapshots: State[] = [];
function sceneStartState(k: number): State {
  if (snapshots[k]) return snapshots[k];
  let s: State;
  if (k === 0) s = initState();
  else {
    s = clone(sceneStartState(k - 1));
    for (const t of scenes[k - 1].timed) apply(s, t.st, 1, t.dur);
  }
  resetTransient(s);
  for (const p of s.panes) if (p.scroll) { p.scroll.p = 1; p.scroll.prev = null; }
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
    apply(s, x.st, x.dur ? clamp((t - x.start) / x.dur, 0, 1) : 1, x.dur);
  }
  s.scene = k;
  s.sceneP = clamp(t / sc.duration, 0, 1);
  s.sceneT = t;
  s.bridge = t < sc.lead ? { p: t / sc.lead } : null;
  // orientation follows what is on screen: a tour scene's file is "current" once it opens
  const early = sc.auto && k > 0 && sc.swapAt > 0;
  s.shown = early && t < sc.swapAt ? k - 1 : k;
  // the outline changes with the screen change (one event), never during the replay that follows
  s.guideScene = k > 0 && ((early && t < sc.swapAt) || (!sc.auto && t < sc.swapEnd)) ? k - 1 : k;
  return s;
}
