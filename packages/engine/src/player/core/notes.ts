// The explanation under a code line, as a pure function of timeline time: it depends only on the
// voice now, when it took its place (t0), and the voice just before that. So a frame is the same
// however it was reached (played into, seeked to, stepped back to). Nothing here remembers history.
//
// Under a new line: the old explanation folds away (OUT), then the new one opens (IN).
// Under the same line: the room stays open and only the words change (SWAP); a fold and an unfold
// in one place would read as two events for one.
import { clamp, ease, easeOut } from './env.ts';

export interface NoteIn { key: string; vi: number; html: string; tone?: string }
export interface NoteView extends NoteIn { h: number; o: number }

export const OUT = 210;
export const IN = 350;
export const SWAP = 290;

/**
 * `t0`: when the current voice took its place (null: no voice). `cur`: it, if it sits under a line
 * of this pane. `prev`: the voice before it, if that sat under a line of this pane.
 */
export function noteViews(T: number, t0: number | null, cur: NoteIn | null, prev: NoteIn | null): NoteView[] {
  if (t0 == null) return [];
  if (cur && prev && prev.vi === cur.vi) return [{ ...cur, h: 1, o: clamp((T - t0) / SWAP, 0, 1) }];
  const out: NoteView[] = [];
  if (prev) {
    const k = clamp((T - t0) / OUT, 0, 1);
    if (k < 1) out.push({ ...prev, h: 1 - ease(k), o: clamp(1 - k * 2, 0, 1) });
  }
  if (cur) {
    const g = clamp((T - t0 - (prev ? OUT : 0)) / IN, 0, 1);
    out.push({ ...cur, h: easeOut(g), o: clamp((g - 0.35) / 0.65, 0, 1) });
  }
  return out;
}
