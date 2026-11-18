// The single explanation shown at a time: the current narration item or the latest
// note, whichever is newer, anchored under the newest code range in the active pane.
import type { Side } from '../../ir/types.ts';
import type { State } from './state.ts';
import { scenes } from './timeline.ts';

export interface Voice {
  kind: 'item' | 'note';
  key: string;
  text: string;
  tone?: string;
  /** item index and count (for the progress dots) */
  k: number;
  n: number;
  anchor: { side: Side; line: number } | null;
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
  if (note && note.t >= itemT) return { kind: 'note', key: `n${note.key}`, text: note.text, tone: note.tone, k: -1, n: 0, anchor: { side: note.side, line: note.line } };
  if (k < 0) return null;
  const cands = pane.hl.filter((h) => h.p > 0 && !h.ref && !String(h.key).startsWith('g')).map((h) => ({ side: h.side, line: h.to, t: h.t || 0 }));
  for (const ty of s.typing) if (ty.file === pane.file && ty.p > 0) cands.push({ side: ty.side, line: ty.to, t: ty.t || 0 });
  if (pane.focus && !cands.length) cands.push({ side: pane.focus.side, line: Math.min(pane.focus.to, pane.focus.from + 12), t: pane.focus.t || 0 });
  cands.sort((a, b) => a.t - b.t);
  const a = cands[cands.length - 1] || null;
  // the lead sentence frames the scene: it stays a caption until code is in play
  const anchor = a && (k > 0 || a.t >= itemT) ? { side: a.side, line: a.line } : null;
  return { kind: 'item', key: `i${s.scene}:${k}`, text: sc.cues.items[k].text, k, n, anchor };
}
