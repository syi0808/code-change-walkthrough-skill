// A value that moves on the timeline clock: it follows play, pause and speed, and
// snaps when time jumps (a seek) instead of animating across the jump.
export class Tween {
  private from = 0;
  private to = 0;
  private t0 = 0;
  private dur = 1;
  private lastT = -Infinity;
  private target: unknown = undefined;

  /** Move toward `to` over `dur` ms of timeline time when `target` changes. Returns the value at T. */
  at(T: number, target: unknown, current: number, to: () => number, dur: number): number {
    const jumped = T < this.lastT || T - this.lastT > 1000;
    this.lastT = T;
    if (target !== this.target) {
      this.target = target;
      this.from = current;
      this.to = to();
      this.t0 = T;
      this.dur = dur;
      if (jumped) this.from = this.to;
    } else if (jumped) this.from = this.to;
    const p = Math.min(1, Math.max(0, (T - this.t0) / this.dur));
    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    return this.from + (this.to - this.from) * e;
  }
}
