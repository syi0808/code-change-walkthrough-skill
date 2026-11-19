// Reading the captions aloud with the browser's speech synthesis (opt-in, remembered per viewer).
//
// Listening is slower than reading, and a sentence cut off mid-way is lost: it is neither heard
// nor read. So speech is never cut by the timeline. While a caption is still being spoken, the
// timeline waits at the point where the next caption would replace it (see holds), then moves on.
// The picture stays a function of the time alone: the timeline only advances later.
import { t } from '../core/env.ts';
import type { Voice } from '../core/voice.ts';
import type { Key } from '../../i18n/index.ts';

const STORE = 'wt-tts';
const TAGS: Record<string, Key> = { info: 'note.info', why: 'note.why', risk: 'note.risk', tip: 'note.tip' };
/** The longest the timeline waits for one caption (a speech engine can fail to report its end). */
const HOLD_MAX = 15000;

/** The words of a caption as they should be heard: no markdown, links read by their text. */
export function speakable(v: Voice): string {
  const text = String(v.text || '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const tag = v.kind === 'note' && v.tone ? (TAGS[v.tone] ? t(TAGS[v.tone]) : v.tone) : '';
  return tag ? `${tag}. ${text}` : text;
}

class Narrator {
  readonly supported = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  on = $state(false);
  /** The caption being spoken (null: silent). */
  private key: string | null = null;
  private busy = false;
  private holdFrom = 0;
  private voice: SpeechSynthesisVoice | null = null;

  constructor() {
    if (!this.supported) return;
    try { this.on = localStorage.getItem(STORE) === '1'; } catch { /* storage unavailable */ }
    const pick = () => { this.voice = choose(speechSynthesis.getVoices(), document.documentElement.lang || 'en'); };
    pick();
    speechSynthesis.addEventListener?.('voiceschanged', pick);
  }

  set(on: boolean): void {
    if (!this.supported) return;
    this.on = on;
    try { localStorage.setItem(STORE, on ? '1' : '0'); } catch { /* storage unavailable */ }
    if (!on) this.stop();
  }

  stop(): void {
    this.key = null; this.busy = false;
    if (this.supported) speechSynthesis.cancel();
  }

  /** Bring the speech in line with the frame (called on every commit). */
  sync(v: Voice | null, playing: boolean, speed: number): void {
    if (!this.on || !this.supported) { if (this.key) this.stop(); return; }
    // paused: a seek elsewhere silences it; a pause at the end of a scene lets the sentence finish
    if (!playing) { if (this.key && v?.key !== this.key) this.stop(); return; }
    if (!v || v.key === this.key) return;
    this.speak(v, speed);
  }

  /** Whether the timeline should wait instead of moving on: to a frame whose caption is not the one
   *  being spoken, or past a point where the screen moves on after a sentence (`gate`). */
  holds(next: () => string | null, gate = false): boolean {
    if (!this.busy || !this.key || (!gate && next() === this.key)) { this.holdFrom = 0; return false; }
    const now = performance.now();
    if (!this.holdFrom) this.holdFrom = now;
    if (now - this.holdFrom > HOLD_MAX) { this.busy = false; this.holdFrom = 0; return false; }
    return true;
  }

  private speak(v: Voice, speed: number): void {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(speakable(v));
    u.lang = this.voice?.lang || document.documentElement.lang || 'en';
    if (this.voice) u.voice = this.voice;
    u.rate = Math.min(2, Math.max(0.5, speed));
    const key = v.key;
    const done = () => { if (this.key === key) { this.busy = false; this.holdFrom = 0; } };
    u.onend = done; u.onerror = done;
    this.key = key; this.busy = true; this.holdFrom = 0;
    speechSynthesis.speak(u);
  }
}

/** A voice for the walkthrough's language: exact tag, then the language; the system default first. */
function choose(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  const want = lang.toLowerCase(), base = want.split('-')[0];
  const rank = (x: SpeechSynthesisVoice) => {
    const l = x.lang.toLowerCase().replace('_', '-');
    const m = l === want ? 0 : l.split('-')[0] === base ? 1 : 9;
    return m * 4 + (x.default ? 0 : 1) + (x.localService ? 0 : 2);
  };
  const ok = voices.filter((x) => rank(x) < 36).sort((a, b) => rank(a) - rank(b));
  return ok[0] || null;
}

export const narrator = new Narrator();
