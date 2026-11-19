// Playback controller. One clock (timeline time T) drives everything on screen:
//   T advances by wall time x speed  ->  frame = state(T)  ->  Svelte updates the DOM
//   ->  layout hooks that need measurements run once, in a fixed order.
// Nothing that carries meaning animates on its own wall-clock timer, so the speed
// control, pause and seeking apply to every motion alike.
import { flushSync } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';
import { clamp, IR } from '../core/env.ts';
import { model } from '../core/model.ts';
import { showFile, stateAt, type State } from '../core/state.ts';
import { gates, sceneAt, scenes, total } from '../core/timeline.ts';
import { settleTop } from '../core/explorer.ts';
import { computeVoice, type Voice } from '../core/voice.ts';
import type { Side, View } from '../../ir/types.ts';
import { narrator } from './narrator.svelte.ts';

export type UserOp = (s: State) => void;
export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
/** Layout hooks run in this order every frame: scroll containers first, then what is measured against them. */
export const ORDER = { explorer: 10, pane: 20, decorations: 30, guide: 40, caption: 45, graph: 50, pointer: 90 } as const;

class Player {
  T = $state(0);
  playing = $state(false);
  speed = $state(1);
  segPause = $state(false);
  atSceneEnd = $state(false);
  started = $state(false);
  /** Exploration while paused; cleared on play / seek. */
  userOps = $state.raw<UserOp[]>([]);
  ui = $state({ explorer: true, guide: true, mobileExplorer: false, map: true, mapExpanded: false, help: false, exFilter: false });
  /** Folders the viewer opened in the explorer; used once they toggle one (manualTree), until playback resumes. */
  expanded = new SvelteSet<string>();
  manualTree = $state(false);
  /** Bumped when layout must be re-measured (resize, panels sliding). */
  epoch = $state(0);

  /** Bumped when computed states must be recomputed (the explorer's size changed). */
  stateVersion = $state(0);

  frame: State = $derived.by(() => {
    void this.stateVersion;
    const s = stateAt(this.T);
    for (const op of this.userOps) op(s);
    // a file opened while exploring is kept in view like any other
    if (this.userOps.length) s.exTop = settleTop(s.exTop, s.exFocus || s.panes[s.active].file, this.T, s.exFocus);
    return s;
  });
  atEnd = $derived(this.started && this.T >= total - 1 && !this.playing);
  live = $derived(this.started && !this.atEnd);
  voice: Voice | null = $derived(!this.live || this.userOps.length ? null : computeVoice(this.frame));
  /** Whether the voice sits under a code line (else it is a floating caption). */
  voicePlaced = $derived.by(() => {
    const v = this.voice, s = this.frame;
    if (!v || !v.anchor) return false;
    const ps = s.panes[s.active];
    if (!ps.file || !IR.files[ps.file]) return false;
    return model(ps.file, ps.view, ps.diff).idx[v.anchor.side].has(v.anchor.line);
  });

  private hooks: { order: number; fn: () => void }[] = [];
  private raf = 0;
  private lastTs = 0;

  /** Register a layout step (DOM measurement / scroll). Returns an unregister function. */
  layout(order: number, fn: () => void): () => void {
    const h = { order, fn };
    this.hooks.push(h);
    this.hooks.sort((a, b) => a.order - b.order);
    return () => { this.hooks = this.hooks.filter((x) => x !== h); };
  }

  /** Apply the current state to the DOM now, then run the layout steps. */
  commit(): void {
    flushSync();
    for (const h of this.hooks) h.fn();
    narrator.sync(this.voice, this.playing, this.speed);
  }

  private tick = (ts: number) => {
    if (!this.playing) return;
    const dt = this.lastTs ? Math.min(100, ts - this.lastTs) : 16;
    this.lastTs = ts;
    const k = sceneAt(this.T);
    const end = scenes[k].t0 + scenes[k].duration;
    const next = this.T + dt * this.speed;
    // a caption still being read aloud is not replaced: the timeline waits for the sentence to end
    // and the screen does not move on (a gate) while the sentence before it is still being spoken
    const gate = gates.some((g) => g > this.T && g <= next);
    if (narrator.holds(() => (next >= total ? null : computeVoice(stateAt(next))?.key ?? null), gate)) { this.raf = requestAnimationFrame(this.tick); return; }
    if (this.segPause && !scenes[k].auto && this.T < end && next >= end && k < scenes.length - 1) {
      this.T = end - 0.5; this.playing = false; this.atSceneEnd = true; this.commit(); return;
    }
    if (next >= total) { this.T = total; this.playing = false; this.commit(); return; }
    this.T = next;
    this.commit();
    this.raf = requestAnimationFrame(this.tick);
  };

  play(): void {
    if (this.T >= total) this.seek(0);
    if (this.atSceneEnd) { this.T = Math.min(total, Math.ceil(this.T + 1)); this.atSceneEnd = false; }
    this.started = true;
    this.userOps = [];
    this.manualTree = false;
    this.playing = true; this.lastTs = 0;
    cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(this.tick);
    this.commit();
  }
  pause(): void { this.playing = false; cancelAnimationFrame(this.raf); narrator.stop(); this.commit(); }
  toggle(): void { if (this.playing) this.pause(); else this.play(); }
  seek(t: number, keepPlaying = false): void {
    this.T = clamp(t, 0, total); this.atSceneEnd = false; this.userOps = []; this.started = true; this.manualTree = false;
    if (!keepPlaying) this.playing = false;
    this.commit();
  }
  gotoScene(k: number, autoplay = this.playing): void {
    this.seek(scenes[clamp(k, 0, scenes.length - 1)].t0 + 1, autoplay);
    if (autoplay && !this.playing) this.play();
  }
  /** Previous scene, or the start of this one when well into it. */
  prevScene(): void { const k = sceneAt(this.T); this.gotoScene(k - (this.T - scenes[k].t0 < 1500 ? 1 : 0)); }
  nextScene(): void { this.gotoScene(sceneAt(this.T) + 1); }

  setSpeed(v: number): void {
    this.speed = v;
    // CSS motion (entrances, fades) runs at the same rate as the timeline
    document.documentElement.style.setProperty('--rate', String(v));
  }
  stepSpeed(dir: 1 | -1): void { this.setSpeed(SPEEDS[clamp(SPEEDS.indexOf(this.speed) + dir, 0, SPEEDS.length - 1)]); }

  /** Exploration while paused: changes the frame on top of the walkthrough state. */
  explore(op: UserOp): void {
    if (this.playing) { this.playing = false; cancelAnimationFrame(this.raf); }
    this.started = true;
    this.userOps = [...this.userOps, op];
    this.commit();
  }
  exploreOpen(file: string, opt: { pane?: number; line?: number | null; side?: Side; view?: View } = {}): void {
    const n = this.userOps.length;
    this.explore((s) => {
      const pane = showFile(s, opt.pane ?? s.active, file, opt.view);
      if (opt.line && IR.files[file]) {
        const r = { side: opt.side || (pane.view === 'before' ? 'before' : 'after'), from: opt.line, to: opt.line } as const;
        pane.scroll = { to: r, mode: 'center', p: 1, prev: null };
        pane.hl.push({ ...r, tone: 'focus', label: null, p: 1, key: 'u' });
        pane.flash = { ...r, key: 'u' + n, p: 0 };
      }
    });
  }

  remeasure(): void { this.epoch++; this.commit(); }
}

export const player = new Player();
