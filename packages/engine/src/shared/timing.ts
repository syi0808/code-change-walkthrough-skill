// Timing model shared by the player (browser) and the compiler (duration estimates).
// Every value is milliseconds of timeline time at 1x. The player advances timeline
// time by wall time x speed, so everything defined here follows the speed control.
// The values are set for comfortable watching at 1x (they were raised by 4/3, so 1x now
// plays at the pace 0.75x used to).
import type { Scene, Step, Walkthrough } from '../ir/types.ts';

export const BASE: Partial<Record<Step['do'], number>> = { open: 930, layout: 600, diffView: 930, reveal: 1130, highlight: 870, focus: 1130, unfocus: 470, note: 930, goto: 3600, refs: 930, impact: 930, graph: 1470, say: 0, wait: 0, clear: 330, close: 470 };

/** Shortest lead-in before every author scene but the first: the bridge card says what comes next and why.
 *  A longer bridge sentence gets the time it takes to read (see leadFor), up to BRIDGE_MAX. */
export const BRIDGE = 2270;
/** A references step: the list comes in, then each item takes REFS_ITEM (point, click, scroll, light up). */
export const REFS_HEAD = 930;
export const REFS_ITEM = 1730;
/** An impact item also carries a verdict (and a relation) to read. */
export const IMPACT_ITEM = 2400;
export const itemMs = (st: Step): number => (st.do === 'impact' ? IMPACT_ITEM : REFS_ITEM);
export const BRIDGE_MAX = 6930;

/** Typing cadence: one constant rhythm, like a person typing (~29 chars/s at 1x). */
export const TYPE_CHAR_MS = 35;
/** Line-by-line cadence for hunks that are not typed. */
export const LINE_MS = 107;

/** Reading time: finding the text, then reading it. Hangul is read per syllable (~470/min,
 *  explanatory prose with technical terms, read alongside code), other scripts per character. */
export function readMs(text: string | undefined): number {
  const s = String(text || '');
  const hangul = (s.match(/[가-힣]/g) || []).length;
  return 1200 + hangul * 127 + (s.length - hangul) * 43;
}

/** A code reference in a sentence sends the eye to the code to check it, and back. */
const LOOK_MS = 670;
/** A beat after a sentence is taken in, so the next one reads as a new event. */
const SETTLE_MS = 400;
/** Time one narration item needs on screen: read it, check the code it names, settle. */
export function dwellMs(text: string | undefined): number {
  return readMs(text) + (/`[^`]+`/.test(String(text || '')) ? LOOK_MS : 0) + SETTLE_MS;
}

/** Replaying an edit by typing: removed lines turn red first, then the new text is typed at a constant cadence. */
export function typeMs(st: Step): number {
  const chars = st._chars || 0, dels = st._dels || 0;
  return Math.round(Math.max(1200, 470 + chars * TYPE_CHAR_MS + (dels ? 600 + dels * 80 : 0)));
}

const delMs = (st: Step) => (st._dels ? 350 + Math.min(st._dels, 30) * 47 : 0);
/** One hunk of the tour: typed (key), line by line (normal), or as one block (skim). */
export function replayMs(st: Step): number {
  if (st._mode === 'type') return typeMs(st);
  if (st._mode === 'lines') return Math.max(600, delMs(st) + 200 + Math.min(st._lines || 0, 400) * LINE_MS);
  return Math.max(750, delMs(st) + 690);
}
export function delShare(st: Step, dur: number): number {
  const d = st._mode === 'type' || st.do === 'type' ? (st._dels ? 600 + st._dels * 80 : 0) : delMs(st);
  return dur ? Math.min(0.6, d / dur) : 0;
}

/**
 * Opening a file is a procedure of separate events, never overlapping (one locus of motion):
 *   locate  the explorer scrolls the row into view, dims the rest, and its selection glides from
 *           the open file to the new one (only the explorer moves)
 *   travel  the pointer moves to the row (or tab), which is now still
 *   press   the click
 *   beat    a short pause, so cause and effect read as two events
 *   swap    the file opens, already at its first change; tab, breadcrumbs and orientation update together
 *   land    (same file only) the editor scrolls to the target
 *   reveal  (when asked) the changed lines sweep in
 */
export type OpenPhaseName = 'locate' | 'travel' | 'press' | 'beat' | 'swap' | 'land' | 'reveal';
export interface Phase<N extends string = string> { name: N; ms: number }

/** One folder move in the explorer: the selection steps onto the row (FOLD_STEP * FOLD_SELECT), then it opens or closes. */
export const FOLD_STEP = 330;
export const FOLD_SELECT = 0.45;
const FOLD_MAX = 8;
/** The explorer's locate phase for a file pick that closes and opens `folds` folders. */
export const locateMs = (folds = 1): number => Math.max(610, (Math.min(folds, FOLD_MAX) + 1) * FOLD_STEP);

export function openPhases(st: Step): Phase<OpenPhaseName>[] {
  const kind = st._openKind || 'tree';
  const k = st.fast ? 0.55 : 1;
  const nav = (ms: number) => Math.round(ms * k);
  const out: Phase<OpenPhaseName>[] = [];
  // locate: one move per folder closed or opened on the way, then the selection reaches the file
  if (kind === 'tree') out.push({ name: 'locate', ms: nav(locateMs(st._fold)) }, { name: 'travel', ms: nav(690) }, { name: 'press', ms: nav(210) }, { name: 'beat', ms: nav(150) });
  if (kind === 'tab') out.push({ name: 'travel', ms: nav(560) }, { name: 'press', ms: nav(210) }, { name: 'beat', ms: nav(120) });
  if (kind !== 'same') out.push({ name: 'swap', ms: 350 });
  if (kind === 'same' && st._r) out.push({ name: 'land', ms: 560 });
  if (st._reveal) out.push({ name: 'reveal', ms: 1270 });
  return out;
}
export const phasesMs = (ph: Phase[]): number => ph.reduce((a, x) => a + x.ms, 0);

/** Which phase a step-local time falls in, and the progress inside it. Past the end: the last phase at 1. */
export function phaseAt<N extends string>(ph: Phase<N>[], ms: number): { name: N | null; p: number; i: number } {
  let acc = 0;
  for (let i = 0; i < ph.length; i++) {
    if (ms < acc + ph[i].ms) return { name: ph[i].name, p: ph[i].ms ? (ms - acc) / ph[i].ms : 1, i };
    acc += ph[i].ms;
  }
  return { name: ph.length ? ph[ph.length - 1].name : null, p: 1, i: ph.length };
}
/** Has the procedure reached (or passed) phase `name`? */
export function reached<N extends string>(ph: Phase<N>[], ms: number, name: N): boolean {
  let acc = 0;
  for (const x of ph) { if (x.name === name) return ms >= acc; acc += x.ms; }
  return true;
}

export function openMs(st: Step): number { return Math.max(400, phasesMs(openPhases(st))); }

export interface NarrationItem { kind: 's' | 'li'; para: number; text: string }

/** Narration items revealed one by one: sentences of prose paragraphs, and list bullets. */
export function narrationItems(text: string | undefined): NarrationItem[] {
  const items: NarrationItem[] = [];
  String(text || '').trim().split(/\n\s*\n/).forEach((para, pi) => {
    const lines = para.split('\n').filter((l) => l.trim());
    if (lines.length && lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      for (const l of lines) items.push({ kind: 'li', para: pi, text: l.replace(/^\s*[-*]\s+/, '') });
      return;
    }
    const flat = lines.join(' ');
    // sentence ends: . ! ? followed by a space or the end, not inside `code`, not a decimal point
    const parts: string[] = [];
    let buf = '', inCode = false;
    for (let i = 0; i < flat.length; i++) {
      const c = flat[i];
      buf += c;
      if (c === '`') inCode = !inCode;
      if (!inCode && /[.!?]/.test(c) && (i + 1 >= flat.length || flat[i + 1] === ' ') && !/\d$/.test(buf.slice(0, -1).slice(-1))) { parts.push(buf.trim()); buf = ''; }
    }
    if (buf.trim()) parts.push(buf.trim());
    for (const t of parts) items.push({ kind: 's', para: pi, text: t });
  });
  return items;
}

export interface Timed { st: Step; start: number; dur: number }

/** Steps that point the viewer at something: the sentence about it should arrive with them. */
const POINTING = new Set<Step['do']>(['highlight', 'focus', 'reveal', 'note', 'goto', 'refs', 'impact', 'type', 'graph']);

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

/** When each narration item appears (scene-local ms). A step may pin an item with `cue: n`;
 *  the rest are spread between pins by the time each needs (dwellMs). layoutScene has already
 *  delayed pinned steps so every item gets that time. */
export function cueTimes(sc: Scene, timed: Timed[], lead: number): Cues {
  const items = narrationItems(sc.narration);
  const n = items.length;
  if (!n) return { items, times: [] };
  const starts = timed.map((x) => x.start), ends = timed.map((x) => x.start + x.dur);
  const spanEnd = ends.length ? Math.max(...ends) : 2670;
  const anchors = new Map<number, number>([[0, lead || 0]]);
  for (const x of timed) { const c = x.st._cue ?? x.st.cue; if (c !== undefined && Number.isInteger(c) && c >= 1 && c <= n && !anchors.has(c - 1)) anchors.set(c - 1, x.start); }
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

export interface SceneLayout { timed: Timed[]; cues: Cues; lead: number; duration: number }

/** Lay out one scene's steps on its local clock. */
export function layoutScene(sc: Scene, lead = 0): SceneLayout {
  let cursor = (sc.auto ? 160 : 470) + lead, prevStart = 0, maxEnd = 0;
  // Reading paces the scene. Narration items and notes are one voice (one thing to read at a
  // time): a step that brings in the next item or a note waits until what is being read has had
  // its time (dwellMs). Animation never cuts a sentence short.
  const items = narrationItems(sc.narration);
  if (!sc.auto) inferCues(sc.steps || [], items.length);
  let pinIdx = 0;
  let ready = items.length ? lead + dwellMs(items[0].text) : 0; // when the current voice has been read
  const timed = (sc.steps || []).map((st): Timed => {
    let dur = st.ms != null && st.do !== 'wait' ? st.ms : BASE[st.do] ?? 800;
    if (st.do === 'wait') dur = st.ms || 0;
    if (st.do === 'refs' || st.do === 'impact') dur = (st.ms || REFS_HEAD) + itemMs(st) * (st._items || st.items || []).length;
    if (st.do === 'type') { dur = st.ms != null ? st.ms : typeMs(st); st._dp = delShare(st, dur); }
    if (st.do === 'open' && st.ms == null) dur = openMs(st);
    if (st.do === 'replay') { dur = st.ms != null ? st.ms : replayMs(st); st._dp = delShare(st, dur); }
    let hold = st.hold || 0;
    if (st.do === 'say') hold += readMs(st.text);
    let start = st.with ? prevStart : cursor;
    const c = st._cue;
    if (c !== undefined && Number.isInteger(c) && c - 1 > pinIdx && c <= items.length) {
      // unpinned items in between are read first
      for (let i = pinIdx + 1; i < c - 1; i++) ready += dwellMs(items[i].text);
      start = Math.max(start, ready);
      pinIdx = c - 1; ready = start + dwellMs(items[c - 1].text);
    } else if (st.do === 'note' && !sc.auto) {
      start = Math.max(start, ready);
      ready = start + dwellMs(st.text);
    }
    prevStart = start;
    cursor = Math.max(st.with ? cursor : 0, start + dur + hold);
    maxEnd = Math.max(maxEnd, cursor);
    return { st, start, dur };
  });
  const cues = cueTimes(sc, timed, lead);
  const lastCue = cues.times.length ? cues.times[cues.times.length - 1] + dwellMs(cues.items[cues.items.length - 1].text) : 0;
  // tour segments carry no narration: no reading time, no dwell
  if (sc.auto) return { timed, cues, lead: 0, duration: maxEnd + 330 };
  return { timed, cues, lead, duration: Math.max(maxEnd + 930, lastCue + 530, ready + 530, lead + 3330) };
}

/** The bridge card stays until its sentence can be read (the question stays on screen all scene). */
export const leadFor = (sc: Scene, index: number): number =>
  index && !sc.auto ? Math.min(BRIDGE_MAX, Math.max(BRIDGE, sc.bridge ? readMs(sc.bridge) + 530 : 0)) : 0;

/** Total duration of an IR in ms at 1x. */
export function totalMs(ir: Pick<Walkthrough, 'chapters'>): number {
  let t = 0, i = 0;
  for (const ch of ir.chapters || []) for (const sc of ch.scenes || []) { t += layoutScene(sc, leadFor(sc, i)).duration; i++; }
  return t;
}
