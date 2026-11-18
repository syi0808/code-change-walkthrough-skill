// Timing model shared by the player (browser) and the compiler (duration estimates).
// Every value is milliseconds of timeline time at 1x. The player advances timeline
// time by wall time x speed, so everything defined here follows the speed control.
import type { Scene, Step, Walkthrough } from '../ir/types.ts';

export const BASE: Partial<Record<Step['do'], number>> = { open: 700, layout: 450, diffView: 700, reveal: 850, highlight: 650, focus: 850, unfocus: 350, note: 700, goto: 2700, refs: 700, graph: 1100, say: 0, wait: 0, clear: 250, close: 350 };

/** Lead-in before every author scene but the first: the bridge card says what comes next and why. */
export const BRIDGE = 1700;

/** Typing cadence: one constant rhythm, like a person typing (~38 chars/s at 1x). */
export const TYPE_CHAR_MS = 26;
/** Line-by-line cadence for hunks that are not typed. */
export const LINE_MS = 80;

/** Reading time. Hangul is read per syllable, other scripts per character. */
export function readMs(text: string | undefined): number {
  const s = String(text || '');
  const hangul = (s.match(/[가-힣]/g) || []).length;
  return 900 + hangul * 75 + (s.length - hangul) * 28;
}

/** Replaying an edit by typing: removed lines turn red first, then the new text is typed at a constant cadence. */
export function typeMs(st: Step): number {
  const chars = st._chars || 0, dels = st._dels || 0;
  return Math.round(Math.max(900, 350 + chars * TYPE_CHAR_MS + (dels ? 450 + dels * 60 : 0)));
}

const delMs = (st: Step) => (st._dels ? 260 + Math.min(st._dels, 30) * 35 : 0);
/** One hunk of the tour: typed (key), line by line (normal), or as one block (skim). */
export function replayMs(st: Step): number {
  if (st._mode === 'type') return typeMs(st);
  if (st._mode === 'lines') return Math.max(450, delMs(st) + 150 + Math.min(st._lines || 0, 400) * LINE_MS);
  return Math.max(420, delMs(st) + 380);
}
export function delShare(st: Step, dur: number): number {
  const d = st._mode === 'type' || st.do === 'type' ? (st._dels ? 450 + st._dels * 60 : 0) : delMs(st);
  return dur ? Math.min(0.6, d / dur) : 0;
}

/**
 * Opening a file is a procedure of separate events, never overlapping (one locus of motion):
 *   locate  the explorer scrolls the row into view and dims the rest (only the explorer moves)
 *   travel  the pointer moves to the row (or tab), which is now still
 *   press   the click
 *   beat    a short pause, so cause and effect read as two events
 *   swap    the file opens, already at its first change; tab, breadcrumbs and orientation update together
 *   land    (same file only) the editor scrolls to the target
 *   reveal  (when asked) the changed lines sweep in
 */
export type OpenPhaseName = 'locate' | 'travel' | 'press' | 'beat' | 'swap' | 'land' | 'reveal';
export interface Phase<N extends string = string> { name: N; ms: number }

export function openPhases(st: Step): Phase<OpenPhaseName>[] {
  const kind = st._openKind || 'tree';
  const k = st.fast ? 0.55 : 1;
  const nav = (ms: number) => Math.round(ms * k);
  const out: Phase<OpenPhaseName>[] = [];
  if (kind === 'tree') out.push({ name: 'locate', ms: nav(380) }, { name: 'travel', ms: nav(520) }, { name: 'press', ms: nav(160) }, { name: 'beat', ms: nav(110) });
  if (kind === 'tab') out.push({ name: 'travel', ms: nav(420) }, { name: 'press', ms: nav(160) }, { name: 'beat', ms: nav(90) });
  if (kind !== 'same') out.push({ name: 'swap', ms: 260 });
  if (kind === 'same' && st._r) out.push({ name: 'land', ms: 420 });
  if (st._reveal) out.push({ name: 'reveal', ms: 950 });
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

export function openMs(st: Step): number { return Math.max(300, phasesMs(openPhases(st))); }

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
export interface Cues { items: NarrationItem[]; times: number[] }

/** When each narration item appears (scene-local ms). A step may pin an item with `cue: n`;
 *  the rest are spread between pins by text length over the span of the scene's steps. */
export function cueTimes(sc: Scene, timed: Timed[], lead: number): Cues {
  const items = narrationItems(sc.narration);
  const n = items.length;
  if (!n) return { items, times: [] };
  const starts = timed.map((x) => x.start), ends = timed.map((x) => x.start + x.dur);
  const spanEnd = ends.length ? Math.max(...ends) : 2000;
  const anchors = new Map<number, number>([[0, lead || 0]]);
  for (const x of timed) { const c = x.st.cue; if (c !== undefined && Number.isInteger(c) && c >= 1 && c <= n && !anchors.has(c - 1)) anchors.set(c - 1, x.start); }
  if (!anchors.has(n)) anchors.set(n, Math.max(spanEnd, starts.length ? Math.max(...starts) : 0));
  const keys = [...anchors.keys()].sort((a, b) => a - b);
  const w = items.map((it) => 10 + it.text.length);
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
  let cursor = (sc.auto ? 120 : 350) + lead, prevStart = 0, maxEnd = 0;
  const timed = (sc.steps || []).map((st): Timed => {
    let dur = st.ms != null && st.do !== 'wait' ? st.ms : BASE[st.do] ?? 600;
    if (st.do === 'wait') dur = st.ms || 0;
    if (st.do === 'refs') dur = (st.ms || 700) + 1300 * (st._items || st.items || []).length;
    if (st.do === 'type') { dur = st.ms != null ? st.ms : typeMs(st); st._dp = delShare(st, dur); }
    if (st.do === 'open' && st.ms == null) dur = openMs(st);
    if (st.do === 'replay') { dur = st.ms != null ? st.ms : replayMs(st); st._dp = delShare(st, dur); }
    let hold = st.hold || 0;
    if (st.do === 'note') hold += readMs(st.text) * 0.55;
    if (st.do === 'say') hold += readMs(st.text);
    const start = st.with ? prevStart : cursor;
    prevStart = start;
    cursor = Math.max(st.with ? cursor : 0, start + dur + hold);
    maxEnd = Math.max(maxEnd, cursor);
    return { st, start, dur };
  });
  const cues = cueTimes(sc, timed, lead);
  const lastCue = cues.times.length ? cues.times[cues.times.length - 1] + readMs(cues.items[cues.items.length - 1].text) * 0.8 : 0;
  // tour segments carry no narration: no reading time, no dwell
  if (sc.auto) return { timed, cues, lead: 0, duration: maxEnd + 250 };
  return { timed, cues, lead, duration: Math.max(maxEnd + 700, lead + readMs(sc.narration) * 0.9 + 600, lastCue + 400, lead + 2500) };
}

export const leadFor = (sc: Scene, index: number): number => (index && !sc.auto ? BRIDGE : 0);

/** Total duration of an IR in ms at 1x. */
export function totalMs(ir: Pick<Walkthrough, 'chapters'>): number {
  let t = 0, i = 0;
  for (const ch of ir.chapters || []) for (const sc of ch.scenes || []) { t += layoutScene(sc, leadFor(sc, i)).duration; i++; }
  return t;
}
