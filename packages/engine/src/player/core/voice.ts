// The single explanation shown at a time: the current narration item or the latest
// note, whichever is newer, anchored under the newest code range in the active pane.
import type { Side } from '../../ir/types.ts';
import { stateAt, type State } from './state.ts';
import { scenes } from './timeline.ts';
import { CLEAR_MS } from '../../shared/procedure.ts';

export interface Voice {
  kind: 'item' | 'note';
  key: string;
  text: string;
  tone?: string;
  /** item index and count (for the progress dots) */
  k: number;
  n: number;
  anchor: { file: string; side: Side; line: number } | null;
  /** When it took its current place, in timeline time: what came before it is `voiceAt(t0 - 1)`. */
  t0: number;
  /** Leaving (0..1): it has been read and closes before the screen moves (see CLEAR_MS). */
  out?: number;
}

export function currentItem(s: State): { k: number; n: number } {
  const times = scenes[s.scene].cues.times;
  let k = -1;
  times.forEach((t0, i) => { if (s.sceneT >= t0) k = i; });
  return { k, n: times.length };
}

export function computeVoice(s: State): Voice | null {
  if (s.bridge) return null;
  const sc = scenes[s.scene];
  const { k, n } = currentItem(s);
  const itemT = k >= 0 ? sc.cues.times[k] : -Infinity;
  const pane = s.panes[s.active];
  const note = pane.notes[pane.notes.length - 1];
  // a sentence leaves at the first gate after it (it has been read, and the screen is about to move):
  // it closes over CLEAR_MS, then it is gone
  const leave = (t: number): number => {
    let g = Infinity;
    for (const x of sc.gates) if (x > t + 1 && x <= s.sceneT && x < g) g = x;
    return g === Infinity ? 0 : (s.sceneT - g) / CLEAR_MS;
  };
  const gone = (t: number) => leave(t) >= 1;
  const leaving = <V extends Voice>(v: V, t: number): V => { const q = leave(t); return q > 0 ? { ...v, out: q } : v; };
  if (note && note.t >= itemT) return gone(note.t) ? null : leaving({ kind: 'note', key: `n${note.key}`, text: note.text, tone: note.tone, k: -1, n: 0, anchor: pane.file ? { file: pane.file, side: note.side, line: note.line } : null, t0: sc.t0 + note.t }, note.t);
  if (k < 0 || gone(itemT)) return null;
  // A sentence sits with the code that was in play when it appeared (its own mark arrives with it),
  // never with code that comes later: it does not jump from the top of the code into it, or from one
  // line to another, while it is being read. The lead sentence frames the scene: it stays a caption.
  const now = (t: number) => t <= itemT + 1;
  const cands = pane.hl.filter((h) => h.p > 0 && !h.ref && !String(h.key).startsWith('g') && now(h.t || 0)).map((h) => ({ side: h.side, line: h.to, t: h.t || 0 }));
  for (const ty of s.typing) if (ty.file === pane.file && ty.p > 0 && now(ty.t || 0)) cands.push({ side: ty.side, line: ty.to, t: ty.t || 0 });
  if (pane.focus && !cands.length && now(pane.focus.t || 0)) cands.push({ side: pane.focus.side, line: Math.min(pane.focus.to, pane.focus.from + 12), t: pane.focus.t || 0 });
  cands.sort((a, b) => a.t - b.t);
  const a = cands[cands.length - 1] || null;
  const anchor = a && pane.file && k > 0 ? { file: pane.file, side: a.side, line: a.line } : null;
  return leaving({ kind: 'item', key: `i${s.scene}:${k}`, text: sc.cues.items[k].text, k, n, anchor, t0: sc.t0 + itemT }, itemT);
}

const before = new Map<number, Voice | null>();
/** The voice at a time (memoized by time: used for the one before the current voice). */
export function voiceAt(T: number): Voice | null {
  if (!before.has(T)) before.set(T, T < 0 ? null : computeVoice(stateAt(T)));
  return before.get(T)!;
}
