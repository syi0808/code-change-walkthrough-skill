// A value that moves on the timeline clock: it follows play, pause and speed, and
// snaps when time jumps (a seek) instead of animating across the jump.
/**
 * A value that follows a target recomputed every frame: when `key` changes it starts from where it is
 * and eases to the target over `dur` ms of timeline time; the target may keep moving (an entry still
 * unfolding) and is tracked to where it ends. `to(from)` gets the value the move started from.
 */
export class Follow {
  private from = 0;
  private t0 = 0;
  private lastT = -Infinity;
  private key: unknown = undefined;

  at(T: number, key: unknown, current: number, to: (from: number) => number, dur: number): number {
    const jumped = T < this.lastT || T - this.lastT > 1000;
    this.lastT = T;
    if (key !== this.key) { this.key = key; this.from = current; this.t0 = T; }
    const target = to(this.from);
    if (jumped) { this.from = target; this.t0 = T - dur; }
    const p = Math.min(1, Math.max(0, (T - this.t0) / dur));
    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    return this.from + (target - this.from) * e;
  }
}
