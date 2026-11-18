// The explanation attached under a code line makes room before it appears and gives
// the room back after it fades, all on the timeline clock: the code below it is pushed
// smoothly instead of jumping (no layout shift).
import { clamp, ease, easeOut } from './env.ts';

export interface NoteIn { key: string; vi: number; html: string; tone?: string }
export interface NoteView extends NoteIn { h: number; o: number }

const OUT = 210; // the old explanation folds away first
const IN = 350; // then the new one opens and fades in
const SWAP = 290; // under the same line: the room stays, the new words fade in

export class NoteTracker {
  private cur: (NoteIn & { t0: number; tSwap?: number }) | null = null;
  private prev: (NoteIn & { tOut: number }) | null = null;
  private lastT = -Infinity;

  /** `snap`: show the end state now (paused, seeking, exploring). */
  update(T: number, next: NoteIn | null, snap: boolean): NoteView[] {
    const jumped = snap || T < this.lastT || T - this.lastT > 600;
    this.lastT = T;
    const id = (n: NoteIn | null) => (n ? `${n.key}@${n.vi}` : '');
    if (id(next) !== id(this.cur)) {
      if (next && this.cur && next.vi === this.cur.vi && !jumped) {
        // the next explanation under the same line: the room stays open and only the words
        // change (a fold and an unfold in the same place would read as two events for one)
        this.prev = null;
        this.cur = { ...next, t0: Math.min(this.cur.t0, T - IN), tSwap: T };
      } else {
        this.prev = this.cur && !jumped ? { ...this.cur, tOut: T } : null;
        this.cur = next ? { ...next, t0: jumped ? T - IN : T + (this.prev ? OUT : 0) } : null;
      }
    } else if (this.cur && next) this.cur.html = next.html;
    if (jumped) { this.prev = null; if (this.cur) { this.cur.t0 = Math.min(this.cur.t0, T - IN); this.cur.tSwap = undefined; } }
    const out: NoteView[] = [];
    if (this.prev) {
      const k = clamp((T - this.prev.tOut) / OUT, 0, 1);
      if (k >= 1) this.prev = null;
      else out.push({ ...this.prev, h: 1 - ease(k), o: clamp(1 - k * 2, 0, 1) });
    }
    if (this.cur) {
      const g = clamp((T - this.cur.t0) / IN, 0, 1);
      const sw = this.cur.tSwap != null ? clamp((T - this.cur.tSwap) / SWAP, 0, 1) : 1;
      out.push({ ...this.cur, h: easeOut(g), o: clamp((g - 0.35) / 0.65, 0, 1) * sw });
    }
    return out;
  }
}
