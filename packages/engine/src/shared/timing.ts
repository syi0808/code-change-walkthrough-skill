// Timing model shared by the player (browser) and the compiler (duration estimates).
// Every value is milliseconds of timeline time at 1x. The player advances timeline
// time by wall time x speed, so everything defined here follows the speed control.
// The values are set for comfortable watching at 1x (they were raised by 4/3, so 1x now
// plays at the pace 0.75x used to).
import type { Step } from '../ir/types.ts';


/** Shortest lead-in before every author scene but the first: the bridge card says what comes next and why.
 *  A longer bridge sentence gets the time it takes to read (see leadFor), up to BRIDGE_MAX. */
export const BRIDGE = 2270;
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
 * How much may change per unit of time. Motion is followed by the eye only up to a speed (smooth
 * pursuit holds up to roughly 30 degrees per second); a move timed by a fixed duration gets
 * faster the more there is to move, and past that speed it is seen as a jump, not as motion. So the
 * time of a motion comes from its amount: content moves at a peak of at most MOVE_V px per ms of
 * timeline time, along the `glide` curve (whose peak is GLIDE_PEAK times its average). An amount
 * over CUT_PX (about a screen) cannot be followed at any speed that fits a step: past it, a motion
 * is shown as a cut (the part beyond is skipped in a dip), so its time stops growing there.
 */
export const MOVE_V = 1.55;
export const CUT_PX = 800;
/** Cubic Bezier (x1, y1, x2, y2) as a function of progress, solved for x by Newton steps, then bisection. */
function bezier(x1: number, y1: number, x2: number, y2: number): (p: number) => number {
  const f = (t: number, a: number, b: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  const df = (t: number, a: number, b: number) => 3 * a * (1 - t) ** 2 + 6 * (b - a) * t * (1 - t) + 3 * (1 - b) * t * t;
  return (p) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    let t = p;
    for (let i = 0; i < 6; i++) { const d = df(t, x1, x2); if (Math.abs(d) < 1e-6) break; t -= (f(t, x1, x2) - p) / d; }
    if (!(t >= 0 && t <= 1) || Math.abs(f(t, x1, x2) - p) > 1e-5) {
      let lo = 0, hi = 1; t = p;
      for (let i = 0; i < 30; i++) { if (f(t, x1, x2) < p) lo = t; else hi = t; t = (lo + hi) / 2; }
    }
    return f(t, y1, y2);
  };
}
/** The curve of a motion whose time follows its amount: it leaves at once (12% of the way in the
 *  first 10% of the time, so the move reads as a response) and settles long onto the target (95% at
 *  75%), where the eye has to land and read. Its peak is 1.82 times its average: a curve that starts
 *  faster peaks higher (2.3 to 2.8), so for the same peak speed its moves take longer. Sine in-out
 *  (1.57) spent as long getting going as arriving, and read as sluggish. */
export const glide = bezier(0.2, 0.15, 0.4, 1);
/** The curve's peak speed as a multiple of its average (measured once). */
export const GLIDE_PEAK = (() => { let m = 0; for (let i = 0; i < 400; i++) m = Math.max(m, (glide((i + 1) / 400) - glide(i / 400)) * 400); return m; })();
/** Past CUT_PX a motion still moves (a jump, even dimmed, reads as a teleport), but the part beyond
 *  goes FAR_X times faster: the eye cannot follow it anyway, and sees the direction and the arrival. */
export const FAR_X = 3;
/** Time for a motion of `px` along `glide`, at least `min`. Up to `cap` px at the followable speed,
 *  the rest FAR_X times faster (the explorer, whose list is short, has no cap). */
export const moveMs = (px: number, min = 0, cap = CUT_PX): number => {
  const d = Math.abs(px), near = Math.min(d, cap), far = d - near;
  return Math.max(min, ((near + far / FAR_X) * GLIDE_PEAK) / MOVE_V);
};
/** Height of an explorer row. */
export const EX_ROW = 22;
/** Height of an editor row, and how many rows an editor keeps in view on either side of its place
 *  (estimates for timing a scroll at compile time; the player measures the real ones). */
export const EDITOR_ROW = 20;
export const EDITOR_HALF_ROWS = 15;

/** One folder click in the explorer walk, at the least: the pointer travels to the folder's row (FOLD_TRAVEL
 *  of the step), presses until FOLD_CLICK, then the folder opens or closes in the rest of the step.
 *  A longer travel or a folder with more rows takes longer (see walkPlan). */
export const FOLD_STEP = 800;
export const FOLD_TRAVEL = 0.45;
export const FOLD_CLICK = 0.6;
/** The end of the walk: the file's row comes into view before the pointer heads for it. */
export const WALK_FILE = 400;
/** Where a walk is at progress p (0..1 of the locate phase): segment k (the last one is the file's
 *  row), the progress within it, and the segment (its shares of travel and press). */
export function walkAt(plan: { ms: number; travel: number; click: number }[], p: number): { k: number; local: number; seg: { ms: number; travel: number; click: number } } {
  const n = plan.length - 1;
  if (p >= 1 || n < 0) return { k: Math.max(0, n), local: 1, seg: plan[n] || { ms: 0, travel: 1, click: 1 } };
  const total = plan.reduce((a, x) => a + x.ms, 0);
  let ms = Math.max(0, p) * total;
  for (let k = 0; k < n; k++) { if (ms < plan[k].ms) return { k, local: ms / plan[k].ms, seg: plan[k] }; ms -= plan[k].ms; }
  return { k: n, local: Math.min(1, plan[n].ms ? ms / plan[n].ms : 1), seg: plan[n] };
}


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
