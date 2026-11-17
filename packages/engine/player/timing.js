/* Walkthrough timing model — shared by the player (browser) and the compiler
 * (Node, for `check` duration estimates). Exposes globalThis.WalkTiming.
 * All values are milliseconds at 1x speed. */
(function (root) {
  'use strict';
  const BASE = { open: 700, layout: 450, diffView: 700, reveal: 850, highlight: 650, focus: 850, unfocus: 350, note: 700, goto: 2700, refs: 700, graph: 1100, say: 0, wait: 0, clear: 250, close: 350 };

  /** Reading time for narration/notes. Hangul is read per syllable, other scripts per character. */
  function readMs(text) {
    const s = String(text || '');
    const hangul = (s.match(/[가-힣]/g) || []).length;
    return 900 + hangul * 75 + (s.length - hangul) * 28;
  }

  /** Replaying an edit: removed lines turn red first, then added text is typed (~38 chars/s at 1x). */
  function typeMs(st) {
    const chars = st._chars || 0, dels = st._dels || 0;
    return Math.round(Math.min(7000, Math.max(900, 350 + chars * 26 + (dels ? 450 + dels * 60 : 0))));
  }

  /** Opening a file is a procedure: find it (explorer or tab) → click → it opens → its changes sweep in. */
  const OPEN_NAV = { tree: 1150, tab: 650, same: 0 };
  const OPEN_REVEAL = 950;
  function openMs(st) {
    const nav = OPEN_NAV[st._openKind || 'tree'];
    return Math.max(450, nav + 350 + (st._reveal ? OPEN_REVEAL : 0));
  }

  /** Split narration into the items revealed one by one: sentences of prose paragraphs, and list bullets. */
  function narrationItems(text) {
    const items = [];
    String(text || '').trim().split(/\n\s*\n/).forEach((para, pi) => {
      const lines = para.split('\n').filter((l) => l.trim());
      if (lines.length && lines.every((l) => /^\s*[-*]\s+/.test(l))) {
        for (const l of lines) items.push({ kind: 'li', para: pi, text: l.replace(/^\s*[-*]\s+/, '') });
      } else {
        const flat = lines.join(' ');
        // sentence ends: . ! ? (also after Korean endings), not inside `code`
        const parts = [];
        let buf = '', inCode = false;
        for (let i = 0; i < flat.length; i++) {
          const c = flat[i];
          buf += c;
          if (c === '`') inCode = !inCode;
          if (!inCode && /[.!?]/.test(c) && (i + 1 >= flat.length || flat[i + 1] === ' ') && !/\d$/.test(buf.slice(0, -1).slice(-1))) { parts.push(buf.trim()); buf = ''; }
        }
        if (buf.trim()) parts.push(buf.trim());
        for (const t of parts) items.push({ kind: 's', para: pi, text: t });
      }
    });
    return items;
  }

  /** When each narration item appears (ms, scene-local). Steps may pin an item with `cue: n`;
   *  the rest are spread between pins by text length over the span of the scene's steps. */
  function cueTimes(sc, timed) {
    const items = narrationItems(sc.narration);
    const n = items.length;
    if (!n) return { items, times: [] };
    const starts = timed.map((x) => x.start), ends = timed.map((x) => x.start + x.dur);
    const spanEnd = ends.length ? Math.max(...ends) : 2000;
    const anchors = new Map([[0, 0]]);
    for (const x of timed) if (Number.isInteger(x.st.cue) && x.st.cue >= 1 && x.st.cue <= n && !anchors.has(x.st.cue - 1)) anchors.set(x.st.cue - 1, x.start);
    if (!anchors.has(n)) anchors.set(n, Math.max(spanEnd, (starts.length ? Math.max(...starts) : 0)));
    const keys = [...anchors.keys()].sort((a, b) => a - b);
    const w = items.map((it) => 10 + it.text.length);
    const times = new Array(n).fill(0);
    for (let a = 0; a < keys.length - 1; a++) {
      const i0 = keys[a], i1 = keys[a + 1], t0 = anchors.get(i0), t1 = Math.max(anchors.get(i1), t0);
      let tot = 0; for (let i = i0; i < i1; i++) tot += w[i];
      let acc = 0;
      for (let i = i0; i < i1 && i < n; i++) { times[i] = i === i0 ? t0 : t0 + (acc / tot) * (t1 - t0); acc += w[i]; }
    }
    return { items, times };
  }

  /** Lay out one scene: returns { timed: [{st, start, dur}], duration }. */
  function scene(sc) {
    let cursor = 350, prevStart = 0, maxEnd = 0;
    const timed = (sc.steps || []).map((st) => {
      let dur = st.ms != null && st.do !== 'wait' ? st.ms : BASE[st.do] ?? 600;
      if (st.do === 'wait') dur = st.ms || 0;
      if (st.do === 'refs') dur = (st.ms || 700) + 1300 * ((st._items || st.items || []).length);
      if (st.do === 'type') dur = st.ms != null ? st.ms : typeMs(st);
      if (st.do === 'open' && st.ms == null) dur = openMs(st);
      let hold = st.hold || 0;
      if (st.do === 'note') hold += readMs(st.text) * 0.55;
      if (st.do === 'say') hold += readMs(st.text);
      const start = st.with ? prevStart : cursor;
      prevStart = start;
      const end = start + dur;
      cursor = Math.max(st.with ? cursor : 0, end + hold);
      maxEnd = Math.max(maxEnd, cursor);
      return { st, start, dur };
    });
    const cues = cueTimes(sc, timed);
    const lastCue = cues.times.length ? cues.times[cues.times.length - 1] + readMs(cues.items[cues.items.length - 1].text) * 0.8 : 0;
    return { timed, cues, duration: Math.max(maxEnd + 700, readMs(sc.narration) * 0.9 + 600, lastCue + 400, 2500) };
  }

  /** Total duration of an IR in ms. */
  function total(ir) {
    let t = 0;
    for (const ch of ir.chapters || []) for (const sc of ch.scenes || []) t += scene(sc).duration;
    return t;
  }

  root.WalkTiming = { BASE, readMs, typeMs, openMs, narrationItems, cueTimes, scene, total };
})(typeof globalThis !== 'undefined' ? globalThis : this);
