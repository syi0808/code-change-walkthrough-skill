/* Code Change Walkthrough — IR player.
 * Renders compiled Walkthrough IR (docs/ir-v1.md) as an IDE-like, seekable animation.
 *
 * Core rule: the visible walkthrough state is a pure function of time.
 *   state(T) = reduce(snapshot(sceneStart), steps started by T, their progress)
 * so play / pause / scrub / speed / jump-to-scene are all "pick a T".
 * Purely visual polish (fades, tab slides, folder expansion) is done with CSS
 * transitions on top, and never feeds back into the state.
 *
 * Layout: [explorer] [editor panes] [walkthrough outline + narration] / controls. */
(function () {
  'use strict';
  const IR = JSON.parse(document.getElementById('walkthrough-ir').textContent);
  const D = window.WalkDiff, HL = window.WalkHL, TM = window.WalkTiming;
  const app = document.getElementById('app');
  const LANG = (IR.meta && IR.meta.language) || document.documentElement.lang || 'en';
  document.documentElement.lang = LANG;
  const KO = LANG.startsWith('ko');
  const T_ = (ko, en) => (KO ? ko : en);

  // ================================================================== helpers
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const ease = (p) => (p <= 0 ? 0 : p >= 1 ? 1 : p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const fmt = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
  const shortRef = (r) => (/^[0-9a-f]{40}$/i.test(String(r)) ? String(r).slice(0, 10) : String(r));
  const restart = (node, cls) => { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); };
  function md(text) {
    const blocks = String(text || '').trim().split(/\n\s*\n/);
    return blocks.map((b) => {
      const lines = b.split('\n');
      if (lines.every((l) => /^\s*[-*]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`;
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    }).join('');
    function inline(s) {
      return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
    }
  }
  const mdInline = (t) => md(t).replace(/^<p>|<\/p>$/g, '');
  const ICON = {
    play: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l9.5-5.5z"/></svg>',
    pause: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3.5 2h3v12h-3zM9.5 2h3v12h-3z"/></svg>',
    prev: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 2h2v12H3zM14 2.5v11L6 8z"/></svg>',
    next: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M11 2h2v12h-2zM2 2.5v11L10 8z"/></svg>',
    restart: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2.5 8a5.5 5.5 0 1 0 1.7-4"/><path d="M2 2.5v3h3"/></svg>',
    explorer: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 3.5h4l1.2 1.5H14v7.5H2z"/></svg>',
    guide: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M5 4h8M5 8h8M5 12h8"/><circle cx="2.5" cy="4" r=".8" fill="currentColor"/><circle cx="2.5" cy="8" r=".8" fill="currentColor"/><circle cx="2.5" cy="12" r=".8" fill="currentColor"/></svg>',
    theme: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="5.5"/><path d="M8 2.5a5.5 5.5 0 0 0 0 11z" fill="currentColor"/></svg>',
    help: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6"/><path d="M6.2 6.3a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4"/><circle cx="8" cy="11.6" r=".4" fill="currentColor"/></svg>',
    close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    chevron: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 4l4 4-4 4"/></svg>',
    unfold: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8 2v4M6 4l2-2 2 2M8 14v-4M6 12l2 2 2-2M3 8h10"/></svg>',
    filter: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 3h12L9.5 8.5V13l-3-1.5v-3z"/></svg>',
    collapse: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M5.5 8h5"/></svg>',
    check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3.5 8.5l3 3 6-7"/></svg>',
    map: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="5" width="4" height="3" rx=".6"/><rect x="10.5" y="2" width="4" height="3" rx=".6"/><rect x="10.5" y="9" width="4" height="3" rx=".6"/><path d="M5.5 6.5h2.5V3.5h2.5M8 6.5v4h2.5"/></svg>',
    expand: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5L9 7M2.5 13.5L7 9"/></svg>',
    shrink: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13.5 6.5h-4v-4M2.5 9.5h4v4M9.5 6.5L14 2M6.5 9.5L2 14"/></svg>',
    pointer: '<svg viewBox="0 0 22 22"><path d="M4 2l13 9.5-5.6 1 3.2 6.3-2.4 1.2-3.2-6.3L4.6 17.5z" fill="#fff" stroke="#111" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  };
  const STATUS_LETTER = { added: 'A', deleted: 'D', modified: 'M', renamed: 'R', copied: 'C' };
  // VS Code-like file icon glyphs (label + colour class) by extension
  const FILE_ICON = { ts: ['TS', 'i-blue'], tsx: ['TSX', 'i-blue'], mts: ['TS', 'i-blue'], cts: ['TS', 'i-blue'], js: ['JS', 'i-yellow'], jsx: ['JSX', 'i-yellow'], mjs: ['JS', 'i-yellow'], cjs: ['JS', 'i-yellow'], json: ['{}', 'i-yellow'], md: ['M↓', 'i-blue'], py: ['PY', 'i-blue'], go: ['GO', 'i-cyan'], rs: ['RS', 'i-orange'], java: ['J', 'i-red'], kt: ['K', 'i-purple'], rb: ['RB', 'i-red'], php: ['PHP', 'i-purple'], css: ['#', 'i-blue'], scss: ['#', 'i-pink'], html: ['<>', 'i-orange'], vue: ['V', 'i-green'], svelte: ['S', 'i-orange'], yml: ['Y', 'i-purple'], yaml: ['Y', 'i-purple'], toml: ['T', 'i-gray'], sql: ['DB', 'i-orange'], sh: ['$', 'i-green'], swift: ['SW', 'i-orange'], c: ['C', 'i-blue'], h: ['H', 'i-purple'], cpp: ['C++', 'i-blue'], cs: ['C#', 'i-green'], dart: ['DA', 'i-cyan'], lock: ['🔒', 'i-gray'], graphql: ['GQ', 'i-pink'], proto: ['PB', 'i-gray'], txt: ['≡', 'i-gray'], env: ['⚙', 'i-gray'] };
  function fileIcon(name) {
    const lower = name.toLowerCase();
    if (lower === 'dockerfile') return ['🐳', 'i-blue'];
    if (lower.startsWith('.env')) return FILE_ICON.env;
    if (/\.(spec|test)\.[a-z]+$/.test(lower)) return ['✓', 'i-green'];
    const ext = lower.includes('.') ? lower.split('.').pop() : '';
    return FILE_ICON[ext] || ['•', 'i-gray'];
  }

  // ================================================================== timeline (see timing.js)
  const scenes = [];
  (IR.chapters || []).forEach((ch, ci) => (ch.scenes || []).forEach((sc, si) => scenes.push({ ...sc, ci, si, chapter: ch })));
  let total = 0;
  for (const sc of scenes) {
    const lay = TM.scene(sc);
    sc.timed = lay.timed;
    sc.cues = lay.cues;
    sc.duration = lay.duration;
    sc.t0 = total;
    total += sc.duration;
  }
  let sid = 0;
  for (const sc of scenes) for (const t of sc.timed) t.st._id = ++sid;

  // ================================================================== state
  const DIFF_DEFAULT = { mode: 'unified', algorithm: 'patience', granularity: 'word', context: 3, whitespace: 'collapse' };
  const newPane = () => ({ tabs: [], file: null, view: 'after', diff: { ...DIFF_DEFAULT }, scroll: null, mem: {}, hl: [], focus: null, notes: [], flash: null, tokline: null });
  const initState = () => ({ layout: 'single', active: 0, panes: [newPane(), newPane()], pointer: null, keys: null, toast: null, refs: null, graph: null, map: null, say: '', typing: [], exFocus: null, reveal: null });
  function resetTransient(s) {
    for (const p of s.panes) { p.hl = []; p.focus = null; p.notes = []; p.flash = null; p.tokline = null; }
    s.pointer = null; s.keys = null; s.toast = null; s.refs = null; s.graph = null; s.say = ''; s.typing = []; s.exFocus = null; s.reveal = null;
  }
  function setScroll(pane, to, mode, p) {
    const prev = pane.scroll;
    if (prev) prev.prev = prev.mode === 'ensure' && prev.prev ? { ...prev.prev, prev: null } : null;
    pane.scroll = { to, mode: mode || 'center', p: p == null ? 1 : p, prev: prev && prev.to ? prev : null };
    pane.mem[pane.file] = to;
  }
  const defaultView = (f) => (!f || f.status === 'context' || f.status === 'added' ? 'after' : f.status === 'deleted' ? 'before' : 'diff');
  function showFile(s, pi, file, view) {
    const pane = s.panes[pi];
    if (pi === 1) s.layout = 'columns';
    s.active = pi;
    const f = IR.files[file];
    if (f) {
      if (!view) view = pane.file === file ? pane.view : defaultView(f);
      if (view === 'after' && f.after == null) view = 'before';
      if (view === 'before' && f.before == null) view = 'after';
    } else view = 'after'; // a file without embedded content (explorer browsing)
    if (!pane.tabs.includes(file)) pane.tabs.push(file);
    if (pane.file !== file) {
      pane.file = file;
      pane.view = view;
      pane.scroll = { to: pane.mem[file] || { side: view === 'before' ? 'before' : 'after', line: 1 }, mode: pane.mem[file] ? 'center' : 'top', p: 1, prev: null };
    } else pane.view = view;
    return pane;
  }

  function apply(s, st, p, dur) {
    const pi = st._pane != null ? st._pane : st.pane != null ? (st.pane ? 1 : 0) : s.active;
    const pane = s.panes[pi];
    switch (st.do) {
      case 'open': {
        // Procedure (motion rules M3/M4): find the file → click → it opens → its changes sweep in.
        const kind = st._openKind || 'tree';
        const navMs = { tree: 1150, tab: 650, same: 0 }[kind];
        const ms = p >= 1 ? Infinity : p * (dur || 0);
        if (navMs && ms < navMs) {
          const navP = ms / navMs;
          const to = kind === 'tree' ? { kind: 'ex', path: st.file } : { kind: 'tab', pane: pi, file: st.file };
          if (kind === 'tree') s.exFocus = st.file;
          s.pointer = { from: s.pointer && s.pointer.to ? s.pointer.to : null, to, p: ease(clamp((navP - 0.15) / 0.55, 0, 1)), click: navP > 0.78 };
          break; // nothing opens before the click
        }
        if (navMs && ms < navMs + 280 && s.pointer) s.pointer = { ...s.pointer, p: 1, click: false, fade: true };
        else if (navMs && s.pointer && s.pointer.to && (s.pointer.to.kind === 'ex' || s.pointer.to.kind === 'tab')) s.pointer = null;
        s.exFocus = null;
        showFile(s, pi, st.file, st.view);
        if (st.diff) Object.assign(pane.diff, st.diff);
        const after = Number.isFinite(ms) ? clamp((ms - navMs) / Math.max(1, (dur || 1) - navMs), 0, 1) : 1;
        if (st._r) { if (pane.scroll && pane.scroll.to !== st._r) setScroll(pane, st._r, 'center', ease(clamp(after / 0.4, 0, 1))); else pane.scroll.p = 1; }
        if (st._reveal && after < 1) s.reveal = { file: st.file, p: clamp((after - 0.2) / 0.8, 0, 1) };
        break;
      }
      case 'close': {
        const i = pane.tabs.indexOf(st.file);
        if (i >= 0) pane.tabs.splice(i, 1);
        if (pane.file === st.file) { pane.file = null; const last = pane.tabs[pane.tabs.length - 1]; if (last) showFile(s, pi, last); }
        if (pi === 1 && !pane.tabs.length) { s.layout = 'single'; s.active = 0; }
        break;
      }
      case 'layout': s.layout = st.mode; if (st.mode === 'single') s.active = 0; break;
      case 'diffView': {
        if (st.mode) pane.diff.mode = st.mode;
        if (st.algorithm) pane.diff.algorithm = st.algorithm;
        if (st.granularity) pane.diff.granularity = st.granularity;
        if (st.context !== undefined) pane.diff.context = st.context;
        if (st.whitespace) pane.diff.whitespace = st.whitespace;
        const f = pane.file && IR.files[pane.file];
        if (f && f.before != null && f.after != null) pane.view = 'diff';
        break;
      }
      case 'reveal': case 'highlight': case 'focus': case 'note': {
        showFile(s, pi, st._file, st._view);
        const r = st._r; if (!r) break;
        // highlights sweep in line by line over the first 60% of the step
        if (st.do === 'highlight') pane.hl.push({ ...r, tone: st.tone || 'focus', label: st.label || null, p: clamp(p / 0.6, 0, 1), key: st._id });
        if (st.do === 'focus') pane.focus = { ...r, p: clamp(p / 0.5, 0, 1) };
        if (st.do === 'note') pane.notes.push({ side: r.side, line: r.to, text: st.text, tone: st.tone || 'info', key: st._id });
        const mode = st.do === 'reveal' ? st.align || 'center' : st.do === 'focus' ? 'center' : 'ensure';
        if (st.reveal !== false) setScroll(pane, r, mode, ease(clamp(p / 0.7, 0, 1)));
        break;
      }
      case 'type': {
        showFile(s, pi, st._file, st._view);
        const r = st._r; if (!r) break;
        let e = s.typing.find((x) => x.key === st._id);
        if (!e) { e = { key: st._id, file: st._file, side: r.side, from: r.from, to: r.to, p: 0 }; s.typing.push(e); }
        e.p = p;
        setScroll(pane, r, 'ensure', ease(clamp(p / 0.12, 0, 1)));
        break;
      }
      case 'unfocus': for (const pn of st.pane != null ? [pane] : s.panes) pn.focus = null; break;
      case 'clear': for (const pn of st.pane != null ? [pane] : s.panes) { pn.hl = []; pn.notes = []; pn.focus = null; } break;
      case 'goto': {
        const fr = st._from, to = st._to;
        if (!fr || !to) break;
        const P1 = 0.32, P2 = 0.56;
        if (p < P2) {
          showFile(s, pi, fr.file);
          setScroll(pane, { side: fr.side, from: fr.line, to: fr.line }, 'ensure', ease(clamp(p / 0.12, 0, 1)));
          const anchor = { pane: pi, side: fr.side, line: fr.line, token: (st.from || {}).token };
          s.pointer = { from: s.pointer && s.pointer.to ? s.pointer.to : null, to: anchor, p: ease(clamp((p - 0.1) / (P1 - 0.1), 0, 1)), click: p > 0.48 };
          if (p >= P1) { s.keys = ['⌘']; pane.tokline = anchor; }
        } else {
          pane.tokline = null;
          const tp = s.panes[to.pane];
          const same = tp.file === to.file;
          showFile(s, to.pane, to.file, to.view);
          const r = { side: to.side, from: to.from, to: to.to };
          if (same) setScroll(tp, r, 'center', ease((p - P2) / 0.25)); else setScroll(tp, r, 'center', 1);
          tp.hl.push({ ...r, tone: 'focus', label: null, p: clamp((p - P2) / 0.3, 0, 1), key: st._id });
          tp.flash = { side: to.side, from: to.from, to: to.from, key: `${st._id}` };
          s.toast = `${T_('정의로 이동', 'Go to Definition')}  ${(st.from || {}).token || ''} → ${to.file}:${to.line}`;
          s.pointer = p < 0.7 && s.pointer ? { ...s.pointer, p: 1, click: false, fade: true } : null;
          s.keys = null;
        }
        break;
      }
      case 'refs': {
        const items = st._items || [];
        const n = items.length;
        const head = 700 / ((st.ms || 700) + 1300 * n);
        const k = p < head ? -1 : Math.min(n - 1, Math.floor(((p - head) / (1 - head)) * n));
        s.refs = { symbol: st.symbol, title: st.title || null, items, active: k };
        if (k >= 0) {
          const it = items[k];
          const pn = showFile(s, pi, it.file, it.view);
          const local = (((p - head) / (1 - head)) * n) - k;
          const r = { side: it.side, from: it.line, to: it.line };
          setScroll(pn, r, 'center', ease(clamp(local / 0.35, 0, 1)));
          pn.hl = pn.hl.filter((h) => !h.ref);
          pn.hl.push({ ...r, tone: 'info', ref: true, label: it.label, p: clamp(local / 0.3, 0, 1), key: `${st._id}:${k}` });
          s.pointer = k === n - 1 && local > 0.7 ? null : { from: k > 0 ? { kind: 'ref', index: k - 1 } : null, to: { kind: 'ref', index: k }, p: ease(clamp(local / 0.22, 0, 1)), click: local > 0.2 && local < 0.36 };
        }
        break;
      }
      case 'graph': {
        if (st.hide) { s.graph = null; if (st.unpin) s.map = null; break; }
        if (st.nodes) {
          s.graph = { nodes: st.nodes, edges: st.edges || [], title: st.title || T_('관계도', 'Relationships'), size: st.size || 'full', highlight: st.highlight || [], key: st._id };
          if (st.pin !== false) s.map = { nodes: st.nodes, edges: st.edges || [], title: st.title || T_('관계도', 'Relationships'), key: st._id };
        } else if (s.graph) s.graph = { ...s.graph, highlight: st.highlight || [] };
        break;
      }
      case 'say': s.say = st.text; break;
      default: break;
    }
  }

  const snapshots = [];
  function sceneStartState(k) {
    if (snapshots[k]) return snapshots[k];
    let s;
    if (k === 0) s = initState();
    else {
      s = clone(sceneStartState(k - 1));
      for (const t of scenes[k - 1].timed) apply(s, t.st, 1, t.dur);
    }
    resetTransient(s);
    for (const p of s.panes) if (p.scroll) { p.scroll.p = 1; p.scroll.prev = null; }
    snapshots[k] = s;
    return s;
  }
  function sceneAt(T) {
    let k = 0;
    while (k < scenes.length - 1 && T >= scenes[k].t0 + scenes[k].duration) k++;
    return k;
  }
  function stateAt(T) {
    const k = sceneAt(T);
    const sc = scenes[k];
    const s = clone(sceneStartState(k));
    const t = T - sc.t0;
    // An edit that this scene will replay later is "not written yet" until then:
    // its added lines are hidden and its removed lines look unchanged.
    for (const x of sc.timed) {
      if (x.st.do === 'type' && x.st._r && t < x.start) s.typing.push({ key: x.st._id, file: x.st._file, side: x.st._r.side, from: x.st._r.from, to: x.st._r.to, p: 0 });
    }
    for (const x of sc.timed) {
      if (t < x.start) continue;
      apply(s, x.st, x.dur ? clamp((t - x.start) / x.dur, 0, 1) : 1, x.dur);
    }
    s.scene = k;
    s.sceneP = clamp(t / sc.duration, 0, 1);
    s.sceneT = t;
    return s;
  }

  // ================================================================== code models
  // A model holds every row of a file view (no folding). Folding is applied per
  // pane at render time so the walkthrough can unfold exactly what it points at.
  const modelCache = new Map();
  const hlCache = new Map();
  function hlLines(file, side) {
    const key = file + '\0' + side;
    if (!hlCache.has(key)) {
      const f = IR.files[file];
      const lines = f[side] == null ? [] : D.splitLines(f[side]);
      hlCache.set(key, { lines, html: HL.file(lines, f.language) });
    }
    return hlCache.get(key);
  }
  function segHtml(segs, lang, cls) {
    let st = {}, out = '';
    for (const sg of segs) { const r = HL.line(sg.text, lang, st); st = r.st; out += sg.changed && sg.text.trim() ? `<span class="${cls}">${r.html}</span>` : r.html; }
    return out;
  }
  function model(file, view, diff) {
    const key = [file, view, diff.mode, diff.algorithm, diff.granularity, diff.whitespace].join('|');
    if (modelCache.has(key)) return modelCache.get(key);
    const f = IR.files[file];
    const lang = f.language;
    const m = { key, file, view, split: false, plain: view !== 'diff', rows: [], idx: { before: new Map(), after: new Map() }, adds: 0, dels: 0 };
    if (view !== 'diff') {
      const side = view === 'before' ? 'before' : 'after';
      const { html, lines } = hlLines(file, side);
      const marks = {};
      if (side === 'after' && f.before != null && f.after != null && f.status !== 'context') {
        const { rows } = D.compute(f.before, f.after, { algorithm: diff.algorithm, granularity: 'line' });
        let lastNew = 0;
        for (const r of rows) {
          if (r.type === 'add') { marks[r.new] = 'ch-add'; m.adds++; }
          else if (r.type === 'mod' && !r.ws) { marks[r.new] = 'ch-mod'; m.adds++; m.dels++; }
          else if (r.type === 'del') { m.dels++; const at = Math.max(1, lastNew); if (!/ch-delpt/.test(marks[at] || '')) marks[at] = ((marks[at] || '') + ' ch-delpt').trim(); }
          if (r.new) lastNew = r.new;
        }
      } else if (side === 'after' && f.status === 'added') { html.forEach((_, i) => (marks[i + 1] = 'ch-add')); m.adds = html.length; }
      else if (side === 'before' && f.status === 'deleted') { m.dels = html.length; }
      html.forEach((h, i) => { m.rows.push({ cls: marks[i + 1] || '', o: side === 'before' ? i + 1 : null, n: side === 'after' ? i + 1 : null, line: i + 1, html: h, raw: lines[i], eq: true }); m.idx[side].set(i + 1, i); });
    } else {
      const old = hlLines(file, 'before').html, neu = hlLines(file, 'after').html;
      const { rows } = D.compute(f.before, f.after, { algorithm: diff.algorithm, granularity: diff.granularity });
      const ws = diff.whitespace !== 'show';
      const push = (row) => {
        const i = m.rows.length;
        m.rows.push(row);
        const o = row.split ? row.l && row.l.n : row.o, n = row.split ? row.r && row.r.n : row.n;
        if (o) m.idx.before.set(o, i);
        if (n) m.idx.after.set(n, i);
      };
      if (diff.mode === 'split') {
        m.split = true;
        const L = [], R = [];
        const flush = () => { for (let j = 0; j < Math.max(L.length, R.length); j++) push({ split: true, l: L[j] || null, r: R[j] || null, eq: false }); L.length = 0; R.length = 0; };
        for (const x of rows) {
          if (x.type === 'eq') { flush(); push({ split: true, l: { n: x.old, html: old[x.old - 1], raw: x.oldText }, r: { n: x.new, html: neu[x.new - 1], raw: x.newText }, eq: true }); continue; }
          if (x.type === 'del') { m.dels++; L.push({ n: x.old, html: old[x.old - 1], k: 'del', raw: x.oldText }); continue; }
          if (x.type === 'add') { m.adds++; R.push({ n: x.new, html: neu[x.new - 1], k: 'add', raw: x.newText }); continue; }
          flush();
          if (x.ws && ws) { push({ split: true, l: { n: x.old, html: old[x.old - 1], k: 'ws', raw: x.oldText }, r: { n: x.new, html: neu[x.new - 1], k: 'ws', raw: x.newText }, eq: true }); continue; }
          m.adds++; m.dels++;
          push({ split: true, l: { n: x.old, html: x.segOld ? segHtml(x.segOld, lang, 'wd-del') : old[x.old - 1], k: 'del', raw: x.oldText }, r: { n: x.new, html: x.segNew ? segHtml(x.segNew, lang, 'wd-add') : neu[x.new - 1], k: 'add', raw: x.newText }, eq: false });
        }
        flush();
      } else {
        for (const r of rows) {
          if (r.type === 'eq') push({ cls: '', o: r.old, n: r.new, mark: '', html: neu[r.new - 1], raw: r.newText, eq: true });
          else if (r.type === 'del') { m.dels++; push({ cls: 'del', o: r.old, n: null, mark: '−', html: old[r.old - 1], raw: r.oldText }); }
          else if (r.type === 'add') { m.adds++; push({ cls: 'add', o: null, n: r.new, mark: '+', html: neu[r.new - 1], raw: r.newText }); }
          else if (r.ws && ws) push({ cls: 'ws', o: r.old, n: r.new, mark: '', html: neu[r.new - 1], raw: r.newText, eq: true });
          else {
            m.adds++; m.dels++;
            push({ cls: 'del', o: r.old, n: null, mark: '−', html: r.segOld ? segHtml(r.segOld, lang, 'wd-del') : old[r.old - 1], raw: r.oldText });
            push({ cls: 'add', o: null, n: r.new, mark: '+', html: r.segNew ? segHtml(r.segNew, lang, 'wd-add') : neu[r.new - 1], raw: r.newText });
          }
        }
      }
    }
    modelCache.set(key, m);
    return m;
  }
  /** Foldable runs of unchanged rows, GitHub-style: keep `ctx` rows around every change. */
  const foldCache = new Map();
  function foldsOf(m, ctx) {
    if (m.plain || typeof ctx !== 'number') return [];
    const key = m.key + '#' + ctx;
    if (foldCache.has(key)) return foldCache.get(key);
    const n = m.rows.length;
    const keep = new Array(n).fill(false);
    let any = false;
    m.rows.forEach((r, i) => { if (!r.eq) { any = true; for (let j = Math.max(0, i - ctx); j <= Math.min(n - 1, i + ctx); j++) keep[j] = true; } });
    const folds = [];
    if (any) {
      for (let i = 0; i < n;) {
        if (keep[i]) { i++; continue; }
        let j = i; while (j < n && !keep[j]) j++;
        if (j - i >= 4) folds.push({ id: folds.length, a: i, b: j - 1 });
        i = j;
      }
      // GitHub-style hunk header for the hunk that follows each fold
      folds.forEach((f, k) => {
        const end = k + 1 < folds.length ? folds[k + 1].a - 1 : n - 1;
        if (f.b >= n - 1) { f.header = ''; return; }
        let os = null, ol = 0, ns = null, nl = 0;
        for (let i = f.b + 1; i <= end; i++) {
          const r = m.rows[i];
          const o = r.split ? r.l && r.l.n : r.o, nn = r.split ? r.r && r.r.n : r.n;
          if (o) { if (os == null) os = o; ol++; }
          if (nn) { if (ns == null) ns = nn; nl++; }
        }
        f.header = `@@ -${os || 0},${ol} +${ns || 0},${nl} @@`;
      });
      // a leading change needs a header too when the file starts with a change block
    }
    foldCache.set(key, folds);
    return folds;
  }
  /** The rows a pane actually shows: model rows with collapsed folds. */
  function viewOf(m, folds, expanded) {
    const rows = [], idx = { before: new Map(), after: new Map() };
    const mapRow = (i, at) => {
      const r = m.rows[i];
      const o = r.split ? r.l && r.l.n : r.o, n = r.split ? r.r && r.r.n : r.n;
      if (o) idx.before.set(o, at);
      if (n) idx.after.set(n, at);
    };
    let f = 0;
    for (let i = 0; i < m.rows.length;) {
      const fold = folds[f];
      if (fold && i === fold.a) {
        f++;
        if (!expanded.has(fold.id)) {
          const at = rows.length;
          rows.push({ fold });
          for (let j = fold.a; j <= fold.b; j++) mapRow(j, at);
          i = fold.b + 1;
          continue;
        }
        for (let j = fold.a; j <= fold.b; j++) { mapRow(j, rows.length); rows.push({ i: j, unfolded: fold.id }); }
        i = fold.b + 1;
        continue;
      }
      mapRow(i, rows.length);
      rows.push({ i });
      i++;
    }
    return { rows, idx };
  }
  function rowHtml(m, vr, vi) {
    if (vr.fold) {
      const f = vr.fold;
      return `<div class="row fold" data-v="${vi}" data-fold="${f.id}" title="${T_('클릭하여 펼치기', 'Click to expand')}"><span class="fold-gut">${ICON.unfold}</span><span class="txt">${f.header ? `<span class="hunk">${esc(f.header)}</span>` : ''}<span class="fold-n">${f.b - f.a + 1} ${T_('줄 숨김', 'hidden lines')}</span></span></div>`;
    }
    const r = m.rows[vr.i];
    const extra = vr.unfolded != null ? ' unfold' : '';
    if (r.split) {
      const half = (h) => (h ? `<div class="half ${h.k || ''}"><span class="gn">${h.n}</span><span class="mk">${h.k === 'add' ? '+' : h.k === 'del' ? '−' : ''}</span><span class="txt">${h.html || ''}</span></div>` : '<div class="half empty"></div>');
      return `<div class="row split${extra}" data-v="${vi}">${half(r.l)}${half(r.r)}</div>`;
    }
    if (m.plain) return `<div class="row plain ${r.cls}${extra}" data-v="${vi}"><span class="gn">${r.line}</span><span class="cg"></span><span class="txt">${r.html || ''}</span></div>`;
    return `<div class="row ${r.cls}${extra}" data-v="${vi}"><span class="gn o">${r.o || ''}</span><span class="gn n">${r.n || ''}</span><span class="mk">${r.mark || ''}</span><span class="txt">${r.html || ''}</span></div>`;
  }

  // ================================================================== DOM scaffold
  const meta = IR.meta || {};
  const src = IR.source || {};
  app.innerHTML = `
    <header class="wt-top">
      <button class="icon-btn" data-act="explorer" title="${T_('탐색기', 'Explorer')} (B)">${ICON.explorer}</button>
      <div class="title">${esc(meta.title || 'Code walkthrough')}</div>
      ${src.base ? `<span class="range" title="${esc(src.base)} → ${esc(src.head)}">${esc(shortRef(src.base))} → ${esc(src.head === 'WORKTREE' ? T_('작업 트리', 'working tree') : shortRef(src.head))}</span>` : ''}
      ${meta.intent ? `<span class="badge">${esc(meta.intent)}</span>` : ''}
      <span class="spacer"></span>
      <button class="icon-btn" data-act="map" title="${T_('구조 지도', 'Structure map')} (M)" hidden>${ICON.map}</button>
      <button class="icon-btn" data-act="theme" title="${T_('테마', 'Theme')}">${ICON.theme}</button>
      <button class="icon-btn" data-act="help" title="${T_('단축키', 'Shortcuts')} (?)">${ICON.help}</button>
      <button class="icon-btn" data-act="guide" title="${T_('워크스루 패널', 'Walkthrough panel')} (G)">${ICON.guide}</button>
    </header>
    <div class="wt-main">
      <aside class="wt-explorer" aria-label="${T_('탐색기', 'Explorer')}">
        <div class="ex-head"><span>${T_('탐색기', 'Explorer')}</span><span class="ex-actions">
          <button class="icon-btn sm" data-act="ex-filter" title="${T_('변경된 파일만 보기', 'Show changed files only')}">${ICON.filter}</button>
          <button class="icon-btn sm" data-act="ex-collapse" title="${T_('모두 접기', 'Collapse all')}">${ICON.collapse}</button></span></div>
        <div class="ex-root"><span class="tw open">${ICON.chevron}</span>${esc(((IR.tree && IR.tree.root) || T_('저장소', 'repository')).toUpperCase())}</div>
        <div class="ex-body" role="tree"></div>
      </aside>
      <section class="wt-stage">
        <div class="wt-panes"></div>
        <div class="wt-refs" hidden></div>
        <div class="wt-toast" hidden></div>

        <div class="wt-start"><button data-act="play" aria-label="play">${ICON.play}</button><div class="t">${esc(meta.title || '')}</div><div class="s">${scenes.length} ${T_('장면', 'scenes')} · ${T_('약', '~')} ${fmt(total)} · ${T_('Space로 시작', 'Space to start')}</div></div>
      </section>
      <aside class="wt-guide" aria-label="${T_('워크스루', 'Walkthrough')}">
        <div class="gd-head"><span>${T_('워크스루', 'Walkthrough')}</span><span class="gd-meta">${scenes.length} ${T_('장면', 'scenes')} · ${fmt(total)}</span></div>
        <div class="gd-map" hidden></div>
        <div class="gd-body"></div>
        <div class="gd-foot"></div>
      </aside>
    </div>
    <div class="wt-graph" hidden></div>
    <div class="wt-pointer" hidden>${ICON.pointer}<span class="ripple"></span></div>
    <div class="wt-keys" hidden></div>
    <footer class="wt-ctrl">
      <div class="ctrl-btns">
        <button class="icon-btn" data-act="prev" title="${T_('이전 장면', 'Previous scene')} (←)">${ICON.prev}</button>
        <button class="play" data-act="play" title="${T_('재생/일시정지', 'Play/Pause')} (Space)">${ICON.play}</button>
        <button class="icon-btn" data-act="next" title="${T_('다음 장면', 'Next scene')} (→)">${ICON.next}</button>
        <button class="icon-btn" data-act="restart" title="${T_('처음부터', 'Restart')}">${ICON.restart}</button>
      </div>
      <div class="scrub" role="slider" aria-label="${T_('타임라인', 'Timeline')}" tabindex="0"><div class="track"></div><div class="knob"></div><div class="tip"></div></div>
      <div class="ctrl-right">
        <span class="time"></span>
        <select data-act="speed" aria-label="${T_('배속', 'Speed')}">${[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((v) => `<option value="${v}"${v === 1 ? ' selected' : ''}>${v}×</option>`).join('')}</select>
        <label title="${T_('장면이 끝나면 자동으로 멈춥니다 (P)', 'Pause at the end of each scene (P)')}"><input type="checkbox" data-act="segpause" checked> ${T_('장면마다 멈춤', 'Pause per scene')}</label>
      </div>
      <div class="ctrl-hint"></div>
    </footer>`;
  const $ = (sel) => app.querySelector(sel);
  const panesEl = $('.wt-panes');
  const paneEls = [0, 1].map((i) => {
    const p = el('div', 'pane');
    p.innerHTML = '<div class="tabs"></div><div class="crumbs"></div><div class="editor"><div class="code"></div></div>';
    panesEl.appendChild(p);
    return { root: p, tabs: p.querySelector('.tabs'), crumbs: p.querySelector('.crumbs'), editor: p.querySelector('.editor'), code: p.querySelector('.code'), idx: i,
      viewKey: '', view: null, model: null, rowEls: [], deco: [], noteSig: '', tabSig: '', tabList: [], crumbSig: '', scrollSig: '', labSig: '', tok: null, file: null, userExpanded: new Map(), typSig: '' };
  });

  // ================================================================== explorer (VS Code-like tree)
  const ex = { root: null, expanded: new Set(), filter: false, revealed: null, prevVisible: new Set(), sig: '' };
  const changedStatus = (p) => { const f = IR.files[p]; return f && f.status !== 'context' ? f.status : null; };
  (function buildTree() {
    const root = { name: '', path: '', dirs: new Map(), files: [], changed: 0, partial: false };
    const ensureDir = (dpath) => {
      if (!dpath) return root;
      let node = root, acc = '';
      for (const part of dpath.split('/')) {
        acc = acc ? acc + '/' + part : part;
        if (!node.dirs.has(part)) node.dirs.set(part, { name: part, path: acc, dirs: new Map(), files: [], changed: 0, partial: false });
        node = node.dirs.get(part);
      }
      return node;
    };
    const seen = new Set();
    const addFile = (p) => {
      if (seen.has(p)) return; seen.add(p);
      const i = p.lastIndexOf('/');
      ensureDir(i < 0 ? '' : p.slice(0, i)).files.push({ name: p.slice(i + 1), path: p });
    };
    if (IR.tree) {
      for (const [d, name] of IR.tree.files) { const dir = IR.tree.dirs[d]; addFile(dir ? dir + '/' + name : name); }
      for (const d of IR.tree.partial || []) ensureDir(d).partial = true;
    }
    for (const p of Object.keys(IR.files)) addFile(p);
    const sortTree = (n) => {
      n.dirList = [...n.dirs.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      n.files.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      n.changed = n.files.filter((f) => changedStatus(f.path)).length;
      for (const c of n.dirList) n.changed += sortTree(c);
      return n.changed;
    };
    sortTree(root);
    ex.root = root;
    // start with every changed file visible
    for (const p of Object.keys(IR.files)) if (changedStatus(p)) for (const a of ancestors(p)) ex.expanded.add(a);
  })();
  function ancestors(p) { const parts = p.split('/'); const out = []; for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/')); return out; }
  /** Follow single-child directory chains (VS Code "compact folders"). */
  function compact(dir) {
    let node = dir; const names = [dir.name];
    while (node.files.length === 0 && node.dirList.length === 1 && !node.partial) { node = node.dirList[0]; names.push(node.name); }
    return { node, label: names.join('/') };
  }
  function renderExplorer(s) {
    const activeFile = s.panes[s.active].file;
    const target = s.exFocus || activeFile; // a file being picked in the explorer, else the active file
    if (target && ex.revealed !== target) { for (const a of ancestors(target)) ex.expanded.add(a); }
    const open = new Set(s.panes.flatMap((p) => p.tabs));
    const sig = [started, activeFile, s.exFocus, [...open].join(','), [...ex.expanded].length, ex.filter, ex.version || 0].join('|');
    const body = $('.ex-body');
    if (sig === ex.sig) return;
    ex.sig = sig;
    const rows = [];
    const visible = new Set();
    const walk = (node, depth) => {
      for (const d of node.dirList) {
        if (ex.filter && !d.changed) continue;
        const { node: leaf, label } = compact(d);
        const isOpen = ex.expanded.has(leaf.path);
        visible.add(leaf.path);
        rows.push({ kind: 'dir', path: leaf.path, label, depth, open: isOpen, changed: leaf.changed, partial: leaf.partial });
        if (isOpen) walk(leaf, depth + 1);
      }
      for (const f of node.files) {
        const st = changedStatus(f.path);
        if (ex.filter && !st) continue;
        visible.add(f.path);
        rows.push({ kind: 'file', path: f.path, label: f.name, depth, status: st, embedded: !!IR.files[f.path] });
      }
      if (node.partial && node !== ex.root) rows.push({ kind: 'more', path: node.path + '/…', label: T_('(일부 파일 생략)', '(some files omitted)'), depth });
    };
    walk(ex.root, 0);
    const guides = (depth) => { let g = ''; for (let k = 0; k < depth; k++) g += `<span class="ig" style="left:${14 + k * 12}px"></span>`; return g; };
    body.innerHTML = rows.map((r) => {
      const isNew = ex.prevVisible.size && !ex.prevVisible.has(r.path) ? ' appear' : '';
      const pad = `style="padding-left:${8 + r.depth * 12}px"`;
      if (r.kind === 'more') return `<div class="ex-row more" ${pad}>${guides(r.depth)}<span class="tw"></span><span class="nm">${esc(r.label)}</span></div>`;
      if (r.kind === 'dir') {
        // folders on the target's path stay legible (where am I), the rest recede (focus+context, M10)
        const onPath = target && (target === r.path || target.startsWith(r.path + '/'));
        return `<div class="ex-row dir${r.changed ? ' has-changes' : ''}${onPath ? ' path' : ''}${isNew}" role="treeitem" aria-expanded="${r.open}" data-dir="${esc(r.path)}" ${pad} title="${esc(r.path)}">${guides(r.depth)}<span class="tw${r.open ? ' open' : ''}">${ICON.chevron}</span><span class="nm">${esc(r.label)}</span>${r.changed ? '<span class="dot"></span>' : ''}</div>`;
      }
      const [glyph, color] = fileIcon(r.label);
      const cls = ['ex-row', 'file', r.status ? `st-${r.status}` : '', open.has(r.path) ? 'open' : '', r.path === activeFile && !s.exFocus ? 'active' : '', r.path === s.exFocus ? 'selecting' : '', r.path === target ? 'target' : '', r.embedded ? '' : 'stub', isNew].filter(Boolean).join(' ');
      return `<div class="${cls}" role="treeitem" data-file="${esc(r.path)}" ${pad} title="${esc(r.path)}${r.embedded ? '' : ' — ' + T_('내용 미포함', 'content not embedded')}">${guides(r.depth)}<span class="tw"></span><span class="fi ${color}">${glyph}</span><span class="nm">${esc(r.label)}</span>${r.status ? `<span class="sb">${STATUS_LETTER[r.status] || ''}</span>` : ''}</div>`;
    }).join('');
    ex.prevVisible = visible;
    body.classList.toggle('spot', !!target && started);
    if (target && ex.revealed !== target) {
      ex.revealed = target;
      const row = Array.from(body.querySelectorAll('.ex-row')).find((r) => r.dataset.file === target);
      if (row) {
        // centre it (M5): a row parked at the panel edge is easy to miss
        const b = body.getBoundingClientRect(), r = row.getBoundingClientRect();
        if (r.top < b.top + 24 || r.bottom > b.bottom - 24) {
          const y = body.scrollTop + (r.top - b.top) - body.clientHeight / 2 + r.height / 2;
          body.scrollTo({ top: Math.max(0, y), behavior: playing ? 'smooth' : 'auto' });
        }
      }
    }
  }

  // ================================================================== walkthrough guide (right panel)
  /** Narration rendered as items (sentences / bullets) that appear in sync with the steps (M8). */
  function narrationHtml(S) {
    const items = (S.cues && S.cues.items) || [];
    if (!items.length) return md(S.narration);
    let html = '', para = -1, inList = false;
    items.forEach((it, i) => {
      if (it.para !== para) {
        if (para >= 0) html += inList ? '</ul>' : '</p>';
        para = it.para; inList = it.kind === 'li';
        html += inList ? '<ul>' : '<p>';
      }
      const body = `<span class="sn" data-k="${i}">${mdInline(it.text)}</span>`;
      html += inList ? `<li class="sn-li" data-k="${i}">${body}</li>` : body + ' ';
    });
    html += inList ? '</ul>' : '</p>';
    return html;
  }
  const guideBody = $('.gd-body');
  {
    let html = `<section class="gd-sec gd-overview open"><button class="gd-sec-h" data-sec="overview">${T_('개요', 'Overview')}</button><div class="gd-detail"><div class="gd-inner">
      <div class="gd-text">${md(meta.summary || '')}</div>
      ${meta.strategy ? `<div class="gd-strategy"><b>${T_('진행 방식', 'How this is ordered')}${meta.strategy.order ? ` · ${esc(meta.strategy.order)}` : ''}</b>${md(meta.strategy.rationale || '')}</div>` : ''}
    </div></div></section><ol class="gd-chapters">`;
    let k = 0;
    (IR.chapters || []).forEach((ch, ci) => {
      html += `<li class="gd-ch" data-ch="${ci}"><div class="gd-ch-h"><span class="no">${ci + 1}</span><span class="t">${esc(ch.title || '')}</span></div><ol class="gd-scenes">`;
      for (const sc of ch.scenes || []) {
        const S = scenes[k];
        html += `<li class="gd-sc" data-scene="${k}"><button class="gd-sc-h" data-scene="${k}"><span class="bullet">${ICON.check}</span><span class="t">${esc(sc.title || sc.id)}</span><span class="dur">${fmt(S.duration)}</span></button>
          <div class="gd-detail"><div class="gd-inner">${sc.goal ? `<div class="gd-goal"><b>${T_('목표', 'Goal')}</b>${esc(sc.goal)}</div>` : ''}<div class="gd-text">${narrationHtml(S)}</div><div class="gd-say"></div></div></div>
          <div class="gd-prog"><i></i></div></li>`;
        k++;
      }
      html += '</ol></li>';
    });
    html += '</ol>';
    const take = meta.takeaways || [], rf = meta.reviewFocus || [];
    html += `<section class="gd-sec gd-recap"><button class="gd-sec-h" data-sec="recap">${T_('정리', 'Recap')}</button><div class="gd-detail"><div class="gd-inner">
      ${take.length ? `<h4>${T_('핵심 요약', 'Key takeaways')}</h4><ul>${take.map((t) => `<li>${mdInline(t)}</li>`).join('')}</ul>` : ''}
      ${rf.length ? `<h4>${T_('리뷰 때 확인할 것', 'Review checklist')}</h4><ul class="rf">${rf.map((t) => `<li>${mdInline(t)}</li>`).join('')}</ul>` : ''}
      <p class="muted">${T_('일시정지 중에는 탐색기에서 파일을 열거나 ⌘/Ctrl+클릭으로 정의로 이동할 수 있습니다.', 'While paused, open files from the explorer or ⌘/Ctrl+Click to go to a definition.')}</p>
    </div></div></section>`;
    guideBody.innerHTML = html;
    const g = IR.glossary || [];
    $('.gd-foot').innerHTML = g.length ? `<details><summary>${T_('용어', 'Glossary')} (${g.length})</summary><dl>${g.map((x) => `<dt>${esc(x.term)}</dt><dd>${esc(x.definition)}</dd>`).join('')}</dl></details>` : '';
  }
  const scItems = Array.from(guideBody.querySelectorAll('.gd-sc'));
  const guide = { cur: -9, say: null, sec: { overview: true, recap: false } };
  function renderGuide(s) {
    const atEnd = started && T >= total - 1 && !playing;
    const cur = !started ? -1 : atEnd ? scenes.length : s.scene;
    if (cur !== guide.cur) {
      guide.cur = cur;
      scItems.forEach((li, i) => {
        if (i !== cur) { delete li.dataset.ci; li.querySelectorAll('.sn-next, .sn-cur, .sn-past').forEach((e) => e.classList.remove('sn-next', 'sn-cur', 'sn-past')); }
        li.classList.toggle('cur', i === cur);
        li.classList.toggle('done', cur >= 0 && i < cur);
        li.classList.toggle('open', i === cur);
      });
      guideBody.querySelectorAll('.gd-ch').forEach((ch) => {
        const ci = Number(ch.dataset.ch);
        ch.classList.toggle('cur', cur >= 0 && cur < scenes.length && scenes[cur].ci === ci);
        ch.classList.toggle('done', cur >= 0 && scenes.filter((x) => x.ci === ci).every((x) => scenes.indexOf(x) < cur));
      });
      guideBody.querySelector('.gd-overview').classList.toggle('open', cur < 0 || guide.sec.overviewPinned === true);
      guideBody.querySelector('.gd-recap').classList.toggle('open', atEnd || guide.sec.recapPinned === true);
      guideBody.querySelector('.gd-recap').classList.toggle('cur', atEnd);
      guide.say = null;
      const target = cur < 0 ? guideBody.querySelector('.gd-overview') : cur >= scenes.length ? guideBody.querySelector('.gd-recap') : scItems[cur];
      if (target) setTimeout(() => target.scrollIntoView({ block: cur >= scenes.length ? 'start' : 'nearest', behavior: 'smooth' }), 60);
    }
    if (cur >= 0 && cur < scenes.length) {
      const li = scItems[cur];
      li.querySelector('.gd-prog i').style.width = `${(s.sceneP * 100).toFixed(1)}%`;
      const times = (scenes[cur].cues && scenes[cur].cues.times) || [];
      let curItem = -1;
      times.forEach((t0, k) => { if (s.sceneT >= t0) curItem = k; });
      if (li.dataset.ci !== String(curItem)) {
        li.dataset.ci = String(curItem);
        li.querySelectorAll('.sn').forEach((e) => {
          const k = Number(e.dataset.k);
          const host = e.parentElement.classList.contains('sn-li') ? e.parentElement : e;
          host.classList.toggle('sn-next', k > curItem);
          host.classList.toggle('sn-cur', k === curItem);
          host.classList.toggle('sn-past', k < curItem);
        });
      }
      if (s.say !== guide.say) {
        guide.say = s.say;
        const say = li.querySelector('.gd-say');
        say.innerHTML = s.say ? md(s.say) : '';
        if (s.say) restart(say, 'in');
      }
    }
  }

  // ================================================================== scrubber
  const track = $('.scrub .track');
  const chSpans = [];
  (IR.chapters || []).forEach((ch, ci) => {
    const scs = scenes.filter((x) => x.ci === ci);
    if (!scs.length) return;
    const t0 = scs[0].t0, t1 = scs[scs.length - 1].t0 + scs[scs.length - 1].duration;
    const seg = el('div', 'seg', '<div class="fill"></div>');
    seg.style.flex = String(t1 - t0);
    seg.title = ch.title || '';
    track.appendChild(seg);
    chSpans.push({ t0, t1, fill: seg.firstChild });
  });
  for (const sc of scenes.slice(1)) {
    if (sc.si === 0) continue;
    const tk = el('div', 'tick'); tk.style.left = `${(sc.t0 / total) * 100}%`; $('.scrub').appendChild(tk);
  }

  // ================================================================== player state
  let T = 0, playing = false, speed = 1, segPause = true, atSceneEnd = false, started = false;
  let userOps = []; // exploration while paused; cleared on play / seek
  let lastRefsSig = '', lastGraphKey = null, lastGraphHl = '', lastFlash = ['', ''];

  // ================================================================== render
  function render() {
    const s = stateAt(T);
    for (const op of userOps) op(s);
    panesEl.classList.toggle('columns', s.layout === 'columns');
    s.panes.forEach((ps, i) => renderPane(paneEls[i], ps, i === s.active, s));
    renderPointer(s);
    renderRefs(s);
    renderGraph(s);
    const toast = $('.wt-toast');
    if (!!s.toast !== !toast.hidden || (s.toast && toast.textContent !== s.toast)) { toast.hidden = !s.toast; if (s.toast) { toast.textContent = s.toast; restart(toast, 'in'); } }
    renderExplorer(s);
    renderGuide(s);
    renderChrome(s);
    $('.wt-start').classList.toggle('gone', started);
  }

  function rangeRows(P, r) {
    // contiguous view-row span of a line range, so interleaved rows of the other side stay inside
    const map = P.view.idx[r.side]; let lo = Infinity, hi = -1;
    for (let ln = r.from; ln <= r.to; ln++) { const i = map.get(ln); if (i != null) { lo = Math.min(lo, i); hi = Math.max(hi, i); } }
    return hi < 0 ? [] : Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
  }
  function modelRowsOf(m, r) {
    const map = m.idx[r.side]; let lo = Infinity, hi = -1;
    for (let ln = r.from; ln <= r.to; ln++) { const i = map.get(ln); if (i != null) { lo = Math.min(lo, i); hi = Math.max(hi, i); } }
    return hi < 0 ? null : [lo, hi];
  }

  function renderPane(P, ps, active, s) {
    P.root.classList.toggle('active', active && s.layout === 'columns');
    // ---- tabs (new tabs slide in)
    const tabSig = ps.tabs.join('|') + '#' + ps.file + '#' + ps.view;
    if (tabSig !== P.tabSig) {
      const prev = new Set(P.tabList);
      P.tabSig = tabSig; P.tabList = ps.tabs.slice();
      P.tabs.innerHTML = ps.tabs.map((f) => {
        const st = IR.files[f] ? IR.files[f].status : null;
        const name = f.split('/').pop();
        const [glyph, color] = fileIcon(name);
        const mode = f === ps.file ? (ps.view === 'diff' ? 'diff' : ps.view === 'before' ? T_('이전', 'before') : '') : '';
        return `<button class="tab${f === ps.file ? ' on' : ''}${prev.size && !prev.has(f) ? ' tab-new' : ''}${st && st !== 'context' ? ` st-${st}` : ''}" data-file="${esc(f)}" data-pane="${P.idx}" title="${esc(f)}"><span class="fi ${color}">${glyph}</span><span class="nm">${esc(name)}</span>${mode ? `<span class="mode">${mode}</span>` : ''}${st && STATUS_LETTER[st] ? `<span class="sb">${STATUS_LETTER[st]}</span>` : ''}</button>`;
      }).join('');
      const on = P.tabs.querySelector('.tab.on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    if (!ps.file) {
      if (P.viewKey !== '∅') { P.viewKey = '∅'; P.model = null; P.view = null; P.file = null; P.code.innerHTML = `<div class="empty-pane">${T_('열린 파일 없음', 'No file open')}</div>`; P.crumbs.innerHTML = ''; P.crumbSig = ''; }
      return;
    }
    const f = IR.files[ps.file];
    if (!f) { // explorer-only file: no content embedded
      const key = 'stub:' + ps.file;
      if (P.viewKey !== key) {
        P.viewKey = key; P.model = null; P.view = null; P.file = ps.file;
        P.crumbs.innerHTML = `<span class="path">${ps.file.split('/').map(esc).join('<i>›</i>')}</span>`; P.crumbSig = '';
        P.code.innerHTML = `<div class="empty-pane stub"><div>${T_('이 파일의 내용은 워크스루에 포함되지 않았습니다.', 'This file’s content is not embedded in the walkthrough.')}</div><div class="muted">${T_('변경과 관련된 파일만 내용이 들어 있습니다.', 'Only files related to the change are embedded.')}</div></div>`;
        restart(P.code, 'enter');
      }
      return;
    }
    const m = model(ps.file, ps.view, ps.diff);
    const ctx = ps.view === 'diff' ? ps.diff.context : null;
    const folds = foldsOf(m, ctx);
    // ---- unfold whatever the walkthrough currently points at
    const expanded = new Set(P.userExpanded.get(m.key) || []);
    if (folds.length) {
      const refs = [];
      for (const h of ps.hl) refs.push(h);
      if (ps.focus) refs.push(ps.focus);
      for (const n of ps.notes) refs.push({ side: n.side, from: n.line, to: n.line });
      if (ps.flash) refs.push(ps.flash);
      if (ps.tokline) refs.push({ side: ps.tokline.side, from: ps.tokline.line, to: ps.tokline.line });
      if (ps.scroll && ps.scroll.to) refs.push({ side: ps.scroll.to.side, from: ps.scroll.to.from ?? ps.scroll.to.line, to: ps.scroll.to.to ?? ps.scroll.to.line });
      for (const t of s.typing) if (t.file === ps.file) refs.push(t);
      for (const r of refs) {
        const span = modelRowsOf(m, r);
        if (!span) continue;
        for (const fd of folds) if (fd.a <= span[1] && span[0] <= fd.b) expanded.add(fd.id);
      }
    }
    const viewKey = m.key + '#' + ctx + '#' + [...expanded].sort((a, b) => a - b).join(',');
    let entering = false;
    if (P.viewKey !== viewKey) {
      const fileChanged = P.file !== ps.file || !P.model || P.model.key !== m.key;
      const prevExpanded = P.expanded || new Set();
      P.viewKey = viewKey; P.model = m; P.file = ps.file; P.expanded = expanded;
      P.view = viewOf(m, folds, expanded);
      P.code.innerHTML = P.view.rows.map((vr, vi) => rowHtml(m, vr, vi)).join('');
      P.code.classList.toggle('split-mode', m.split);
      P.code.classList.toggle('plain-mode', m.plain);
      P.rowEls = Array.from(P.code.children);
      // only freshly unfolded rows animate; rows of folds that were already open don't
      if (!fileChanged) P.view.rows.forEach((vr, vi) => { if (vr.unfolded != null && prevExpanded.has(vr.unfolded)) P.rowEls[vi].classList.remove('unfold'); });
      else P.rowEls.forEach((e) => e.classList.remove('unfold'));
      P.deco = new Array(P.rowEls.length).fill('');
      P.noteSig = ''; P.scrollSig = ''; P.labSig = ''; P.typSig = '';
      lastFlash[P.idx] = '';
      if (fileChanged) { entering = true; restart(P.code, 'enter'); }
    }
    // ---- breadcrumbs + GitHub-style diffstat + view switch
    const crumbSig = viewKey + '|' + ps.diff.mode;
    if (crumbSig !== P.crumbSig) {
      P.crumbSig = crumbSig;
      const canDiff = f.before != null && f.after != null && f.status !== 'context';
      const vb = (v, label) => `<button data-view="${v}" data-pane="${P.idx}" class="${(v === ps.view || (ps.view === 'diff' && v === ps.diff.mode)) ? 'on' : ''}">${label}</button>`;
      const totalCh = m.adds + m.dels;
      const blocks = totalCh ? Array.from({ length: 5 }, (_, i) => (i < Math.round((m.adds / totalCh) * 5) ? 'a' : 'd')) : [];
      const stat = totalCh ? `<span class="dstat"><span class="pa">+${m.adds}</span><span class="pd">−${m.dels}</span><span class="sq">${blocks.map((b) => `<i class="${b}"></i>`).join('')}</span></span>` : '';
      P.crumbs.innerHTML = `<span class="path">${ps.file.split('/').map(esc).join('<i>›</i>')}</span>${f.oldPath ? `<span class="sym">← ${esc(f.oldPath)}</span>` : ''}${f.role ? `<span class="sym">${esc(f.role)}</span>` : ''}
        <span class="vbtns">${stat}${canDiff ? vb('after', T_('이후', 'after')) + vb('before', T_('이전', 'before')) + vb('unified', 'unified') + vb('split', 'split') : ''}</span>`;
    }
    const V = P.view;
    // ---- row decorations: highlight (line-by-line sweep), focus, typing replay
    const deco = new Array(V.rows.length).fill('');
    const add = (i, c) => { deco[i] = deco[i] ? deco[i] + ' ' + c : c; };
    const labels = [];
    for (const h of ps.hl) {
      const rs = rangeRows(P, h);
      if (!rs.length || h.p <= 0) continue;
      const shown = Math.max(1, Math.ceil(rs.length * h.p));
      rs.slice(0, shown).forEach((i, k) => { add(i, `hl hl-${h.tone}`); if (k === 0) add(i, 'hl-first'); if (k === shown - 1) add(i, 'hl-last'); });
      if (h.label) labels.push([rs[0], h.label, h.tone]);
    }
    if (ps.focus) {
      const keep = new Set(rangeRows(P, ps.focus));
      for (const h of ps.hl) for (const i of rangeRows(P, h)) keep.add(i);
      if (keep.size) for (let i = 0; i < deco.length; i++) if (!keep.has(i)) add(i, 'dim');
    }
    if (s.reveal && s.reveal.file === ps.file && s.reveal.p < 1) {
      const changed = [];
      V.rows.forEach((vr, vi) => { if (vr.fold) return; const r = m.rows[vr.i]; if (m.plain ? /ch-/.test(r.cls) : !r.eq) changed.push(vi); });
      const shown = Math.floor(changed.length * s.reveal.p);
      for (let k = shown; k < changed.length; k++) add(changed[k], 'chg-pend');
    }
    const typingCur = [];
    for (const t of s.typing) {
      if (t.file !== ps.file || t.p >= 1) continue;
      const rs = rangeRows(P, t);
      const items = [];
      for (const vi of rs) {
        const vr = V.rows[vi]; if (vr.fold) continue;
        const r = m.rows[vr.i];
        if (m.plain) items.push({ vi, add: r.raw || '', addTxt: 0, onlyAdd: true });
        else if (r.split) items.push({ vi, del: r.l && r.l.k === 'del', add: r.r && r.r.k === 'add' ? r.r.raw || '' : null, addTxt: 1, onlyAdd: !(r.l && r.l.k === 'del') });
        else if (r.cls === 'del') items.push({ vi, del: true });
        else if (r.cls === 'add') items.push({ vi, add: r.raw || '', addTxt: 0, onlyAdd: true });
      }
      const dels = items.filter((x) => x.del);
      const addsList = items.filter((x) => x.add != null);
      const delP = dels.length ? clamp(t.p / 0.28, 0, 1) : 1;
      const typeP = dels.length ? clamp((t.p - 0.28) / 0.72, 0, 1) : t.p;
      dels.forEach((x, k) => { if (t.p <= 0 || delP * dels.length <= k) add(x.vi, 'typ-del-pend'); });
      const len = (x) => x.add.replace(/^\s+/, '').length;
      const totalChars = addsList.reduce((a, x) => a + len(x), 0) || 1;
      let budget = typeP * totalChars;
      for (const x of addsList) {
        const L = len(x);
        if (t.p <= 0 || budget <= 0) { add(x.vi, x.onlyAdd && !m.split ? 'typ-hidden' : 'typ-add-pend'); continue; }
        if (budget >= L) { budget -= L; continue; }
        add(x.vi, 'typ-cur');
        typingCur.push({ vi: x.vi, offset: (x.add.length - L) + Math.floor(budget), half: m.split ? 1 : 0 });
        budget = 0;
      }
    }
    for (let i = 0; i < deco.length; i++) {
      if (deco[i] !== P.deco[i]) {
        const e = P.rowEls[i];
        for (const c of (P.deco[i] || '').split(' ')) if (c) e.classList.remove(c);
        for (const c of deco[i].split(' ')) if (c) e.classList.add(c);
      }
    }
    P.deco = deco;
    // the typing caret: clip the current line at the typed character (measured, so wide glyphs work)
    const typSig = JSON.stringify(typingCur);
    if (typSig !== P.typSig) {
      P.code.querySelectorAll('.txt.clip').forEach((t) => { t.classList.remove('clip'); t.style.removeProperty('--clipx'); });
      for (const c of typingCur) {
        const row = P.rowEls[c.vi];
        const txt = c.half ? row.querySelectorAll('.txt')[1] : row.querySelector('.txt');
        if (!txt) continue;
        const pos = locate(txt, c.offset);
        let x = 0;
        if (pos) { const rg = document.createRange(); rg.setStart(pos[0], pos[1]); rg.setEnd(pos[0], pos[1]); x = rg.getBoundingClientRect().left - txt.getBoundingClientRect().left; }
        txt.style.setProperty('--clipx', `${Math.max(0, x)}px`);
        txt.classList.add('clip');
      }
      P.typSig = typSig;
    }
    // ---- highlight labels
    P.code.style.setProperty('--vw', `${P.editor.clientWidth + P.editor.scrollLeft}px`);
    const labSig = JSON.stringify(labels) + viewKey;
    if (labSig !== P.labSig) {
      const prevLabels = new Set(Array.from(P.code.querySelectorAll('.hl-label')).map((x) => x.textContent));
      P.labSig = labSig;
      P.code.querySelectorAll('.hl-label').forEach((x) => x.remove());
      for (const [i, text, tone] of labels) {
        const lb = el('span', `hl-label tone-${tone}${prevLabels.has(text) ? '' : ' in'}`);
        lb.textContent = text;
        P.rowEls[i].appendChild(lb);
      }
    }
    // ---- flash (restart CSS animation only when the flash identity changes)
    const fk = ps.flash ? `${ps.flash.key}:${ps.file}` : '';
    if (fk !== lastFlash[P.idx]) {
      P.code.querySelectorAll('.row.flash').forEach((x) => x.classList.remove('flash'));
      if (ps.flash) for (const i of rangeRows(P, ps.flash)) restart(P.rowEls[i], 'flash');
      lastFlash[P.idx] = fk;
    }
    // ---- inline notes (expand in)
    const noteSig = JSON.stringify(ps.notes.map((n) => [n.key, n.side, n.line])) + viewKey;
    if (noteSig !== P.noteSig) {
      const had = new Set(Array.from(P.code.querySelectorAll('.note')).map((x) => x.dataset.key));
      P.noteSig = noteSig;
      P.code.querySelectorAll('.note').forEach((x) => x.remove());
      for (const n of ps.notes) {
        const i = V.idx[n.side].get(n.line);
        if (i == null) continue;
        const tag = { info: T_('메모', 'note'), why: T_('왜', 'why'), risk: T_('주의', 'risk'), tip: T_('팁', 'tip') }[n.tone] || n.tone;
        const ne = el('div', `note tone-${n.tone}${had.has(String(n.key)) ? '' : ' in'}`, `<div class="note-in"><span class="tag">${esc(tag)}</span>${mdInline(n.text)}</div>`);
        ne.dataset.key = n.key;
        P.rowEls[i].after(ne);
      }
    }
    // ---- scroll
    if (ps.scroll) {
      const sig = JSON.stringify([ps.scroll.to, ps.scroll.mode, ps.scroll.p, viewKey, ps.notes.length, typSig]);
      if (sig !== P.scrollSig || playing) {
        P.scrollSig = sig;
        const y = scrollPx(P, ps.scroll);
        if (y != null && Math.abs(P.editor.scrollTop - y) > 0.5) {
          if (entering || !playing) P.editor.scrollTop = y; else P.editor.scrollTop = y;
        }
      }
    }
    // ---- Cmd-hover underline
    if (ps.tokline) {
      const r = tokenRect(P, ps.tokline);
      let u = P.tok;
      if (!u) { u = P.tok = el('div', 'tokline'); P.code.appendChild(u); }
      if (r) { u.style.left = `${r.left}px`; u.style.top = `${r.bottom - 1}px`; u.style.width = `${r.width}px`; }
    } else if (P.tok) { P.tok.remove(); P.tok = null; }
  }

  function rowRange(P, a) {
    const map = P.view.idx[a.side] || P.view.idx.after;
    const i0 = map.get(a.line != null ? a.line : a.from);
    const i1 = map.get(a.to != null ? a.to : a.line);
    if (i0 == null) return null;
    return [i0, i1 == null ? i0 : i1];
  }
  function nextNoteH(e) { const n = e.nextElementSibling; return n && n.classList.contains('note') ? n.offsetHeight + 8 : 0; }
  function targetPx(P, scroll, fromPx) {
    const rr = rowRange(P, scroll.to);
    if (!rr) return fromPx;
    const e0 = P.rowEls[rr[0]], e1 = P.rowEls[rr[1]];
    if (!e0) return fromPx;
    const top = e0.offsetTop, bottom = e1.offsetTop + e1.offsetHeight + nextNoteH(e1);
    const H = P.editor.clientHeight, rh = e0.offsetHeight || 20;
    const max = Math.max(0, P.code.scrollHeight - H);
    let y;
    if (scroll.mode === 'top') y = top - rh * 3;
    else if (scroll.mode === 'ensure' && fromPx != null && top >= fromPx + rh * 2 && bottom <= fromPx + H - rh * 2) y = fromPx;
    else y = bottom - top > H - rh * 4 ? top - rh * 2 : Math.min((top + bottom) / 2 - H * 0.45, top - rh * 2);
    return clamp(y, 0, max);
  }
  function scrollPx(P, scroll) {
    const prevPx = scroll.prev ? scrollPx(P, { ...scroll.prev, p: 1 }) : null;
    const to = targetPx(P, scroll, prevPx);
    if (scroll.p >= 1 || prevPx == null) return to;
    return prevPx + (to - prevPx) * scroll.p;
  }
  function tokenRect(P, a) {
    if (!P.view) return null;
    const rr = rowRange(P, a); if (!rr) return null;
    const row = P.rowEls[rr[0]];
    let txt = row.querySelector('.txt');
    if (row.classList.contains('split')) txt = row.querySelectorAll('.txt')[a.side === 'before' ? 0 : 1] || txt;
    if (!txt) return null;
    const full = txt.textContent;
    const at = a.token ? full.indexOf(a.token) : -1;
    const base = P.code.getBoundingClientRect();
    let rect;
    if (at >= 0) {
      const range = document.createRange();
      const s0 = locate(txt, at), e0 = locate(txt, at + a.token.length);
      if (s0 && e0) { range.setStart(s0[0], s0[1]); range.setEnd(e0[0], e0[1]); rect = range.getBoundingClientRect(); }
    }
    if (!rect || !rect.width) rect = txt.getBoundingClientRect();
    return { left: rect.left - base.left, top: rect.top - base.top, bottom: rect.bottom - base.top, width: Math.min(rect.width, 400), abs: rect };
  }
  function locate(root, offset) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n, acc = 0, last = null;
    while ((n = w.nextNode())) { last = n; if (acc + n.length >= offset) return [n, offset - acc]; acc += n.length; }
    return last ? [last, last.length] : null;
  }

  function renderPointer(s) {
    const ptr = $('.wt-pointer'), keys = $('.wt-keys');
    if (!s.pointer) { ptr.hidden = true; keys.hidden = true; return; }
    const within = (pt, box) => (box ? { x: clamp(pt.x, box.left + 4, box.right - 8), y: clamp(pt.y, box.top + 4, box.bottom - 10) } : pt);
    const visible = (r, box) => r.bottom > box.top + 2 && r.top < box.bottom - 2 && r.right > box.left && r.left < box.right;
    const pos = (a) => {
      const stage = $('.wt-stage').getBoundingClientRect();
      if (!a) return { x: stage.left + stage.width * 0.62, y: stage.top + stage.height * 0.88 };
      if (a.kind === 'ex') {
        const row = Array.from(document.querySelectorAll('.ex-row')).find((r) => r.dataset.file === a.path);
        const box = $('.ex-body').getBoundingClientRect();
        if (!row || !box.width) return null;
        const r = row.getBoundingClientRect();
        if (!visible(r, box)) return within({ x: r.left + 60, y: r.top + r.height * 0.6 }, box);
        const nm = row.querySelector('.nm').getBoundingClientRect();
        return { x: nm.left + Math.min(nm.width, 80) * 0.5, y: r.top + r.height * 0.62 };
      }
      if (a.kind === 'tab') {
        const tab = paneEls[a.pane].tabs.querySelector(`.tab[data-file="${CSS.escape(a.file)}"]`);
        if (!tab) return null;
        const r = tab.getBoundingClientRect();
        return within({ x: r.left + r.width * 0.5, y: r.top + r.height * 0.6 }, paneEls[a.pane].tabs.getBoundingClientRect());
      }
      if (a.kind === 'ref') {
        const li = $('.wt-refs') && $('.wt-refs').querySelectorAll('li')[a.index];
        if (!li) return null;
        const r = li.getBoundingClientRect();
        return within({ x: r.left + 90, y: r.top + r.height * 0.6 }, $('.wt-refs ol').getBoundingClientRect());
      }
      const P = paneEls[a.pane]; const ps = s.panes[a.pane];
      if (!P.view || !ps.file) return null;
      const r = tokenRect(P, a);
      if (!r) return null;
      return within({ x: r.abs.left + Math.min(r.abs.width, 60) / 2, y: r.abs.top + r.abs.height * 0.7 }, P.editor.getBoundingClientRect());
    };
    const to = pos(s.pointer.to); if (!to) { ptr.hidden = true; keys.hidden = true; return; }
    const from = pos(s.pointer.from) || pos(null);
    const p = s.pointer.p;
    // natural motion: slow-in/slow-out along a gentle arc (M6)
    const dx = to.x - from.x, dy = to.y - from.y, dist = Math.hypot(dx, dy) || 1;
    const bow = Math.sin(Math.PI * p) * Math.min(80, dist * 0.12);
    const x = from.x + dx * p + (-dy / dist) * bow, y = from.y + dy * p + (dx / dist) * bow;
    ptr.hidden = false;
    ptr.style.transform = `translate(${x - 4}px, ${y - 2}px)`;
    ptr.style.opacity = s.pointer.fade ? '0' : '1';
    ptr.classList.toggle('click', !!s.pointer.click);
    keys.hidden = !s.keys;
    if (s.keys) { keys.innerHTML = s.keys.map((k) => `<kbd>${k}</kbd>`).join('') + `<kbd>${T_('클릭', 'Click')}</kbd>`; keys.style.left = `${x}px`; keys.style.top = `${y}px`; }
  }

  function renderRefs(s) {
    const box = $('.wt-refs');
    const sig = s.refs ? JSON.stringify([s.refs.symbol, s.refs.items.length, s.refs.active]) : '';
    if (sig === lastRefsSig) return;
    const wasHidden = box.hidden;
    lastRefsSig = sig;
    if (!s.refs) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    if (wasHidden) restart(box, 'in');
    box.innerHTML = `<header><b>${esc(s.refs.symbol || '')}</b><span>${esc(s.refs.title || T_(`참조 ${s.refs.items.length}곳`, `${s.refs.items.length} references`))}</span></header>
      <ol>${s.refs.items.map((it, i) => `<li class="${i === s.refs.active ? 'on' : ''}${i < s.refs.active ? ' seen' : ''}"><button data-file="${esc(it.file)}" data-line="${it.line}" data-side="${it.side}" data-view="${it.view}"><span class="loc">${esc(it.file.split('/').pop())}<i>:${it.line}</i></span><span class="snip">${esc(it.text)}${it.label ? `<span class="lbl">${esc(it.label)}</span>` : ''}</span></button></li>`).join('')}</ol>`;
    const on = box.querySelector('li.on'); if (on) on.scrollIntoView({ block: 'nearest' });
  }

  const mapUi = { shown: true, expanded: false };
  function renderGraph(s) {
    const box = $('.wt-graph');
    let content = null, mode = 'hidden';
    if (s.graph) { content = s.graph; mode = s.graph.size === 'panel' ? 'panel' : 'full'; }
    else if (s.map && mapUi.shown) { content = s.map; mode = mapUi.expanded ? 'full' : 'mini'; }
    $('[data-act="map"]').classList.toggle('on', !!s.map && mapUi.shown);
    $('[data-act="map"]').hidden = !s.map;
    if (!content) {
      if (lastGraphKey !== null) { box.classList.add('leaving'); setTimeout(() => { if (lastGraphKey === null) { box.hidden = true; box.innerHTML = ''; box.classList.remove('leaving'); } }, 260); lastGraphKey = null; lastGraphHl = ''; }
      return;
    }
    const wasHidden = box.hidden || lastGraphKey === null;
    if (content.key !== lastGraphKey) {
      lastGraphKey = content.key; lastGraphHl = '';
      box.hidden = false; box.classList.remove('leaving');
      box.innerHTML = `<header><span class="t">${esc(content.title)}</span>
        <button class="icon-btn sm" data-act="map-toggle" title="${T_('크게/작게', 'Expand / dock')}">${ICON.expand}</button>
        <button class="icon-btn sm" data-act="graph-close" title="${T_('닫기', 'Close')}">${ICON.close}</button></header><div class="gbody">${graphSvg(content)}</div>`;
      if (wasHidden) restart(box, 'in');
    }
    for (const m of ['full', 'mini', 'panel']) box.classList.toggle(m, m === mode);
    placeGraph(box, mode);
    box.dataset.src = s.graph ? 'graph' : 'map';
    box.querySelector('[data-act="map-toggle"]').innerHTML = mode === 'mini' ? ICON.expand : ICON.shrink;
    box.querySelector('[data-act="map-toggle"]').hidden = mode === 'panel' || (mode === 'full' && !!s.graph);
    // highlights: explicit during the graph's own scene; afterwards the map follows the active file
    const activeFile = s.panes[s.active].file;
    const open = new Set(s.panes.flatMap((p) => p.tabs));
    const hlList = s.graph ? s.graph.highlight || [] : content.nodes.filter((n) => n.file && n.file === activeFile).map((n) => n.id);
    const hlSig = JSON.stringify([hlList, mode, s.graph ? '' : [...open].join(',')]);
    if (hlSig !== lastGraphHl) {
      lastGraphHl = hlSig;
      const hl = new Set(hlList);
      const dimOthers = !!s.graph && hl.size > 0;
      box.querySelectorAll('.g-node').forEach((n) => {
        const on = hl.has(n.dataset.id);
        n.classList.toggle('on', on);
        n.classList.toggle('off', dimOthers && !on);
        n.classList.toggle('visited', !s.graph && !!n.dataset.file && open.has(n.dataset.file) && !on);
      });
      box.querySelectorAll('.g-edge').forEach((e) => { const on = hl.has(`${e.dataset.from}->${e.dataset.to}`) || (hl.has(e.dataset.from) && hl.has(e.dataset.to)); e.classList.toggle('on', on); e.classList.toggle('off', dimOthers && !on); });
    }
  }
  /** The graph lives in a fixed layer and moves between three homes (transitions on its box):
   *  full = over the whole editor stage, mini = the slot at the top of the walkthrough panel
   *  (never covering code), panel = a large card at the editor's top-right. */
  function placeGraph(box, mode) {
    const slot = $('.gd-map');
    const guideVisible = !app.classList.contains('hide-guide') && $('.wt-guide').getBoundingClientRect().width > 120;
    slot.hidden = !(mode === 'mini' && guideVisible);
    const st = $('.wt-stage').getBoundingClientRect();
    let r;
    if (mode === 'full') r = { left: st.left + 14, top: st.top + 14, width: st.width - 28, height: st.height - 28 };
    else if (mode === 'mini' && guideVisible) { const g = slot.getBoundingClientRect(); r = { left: g.left, top: g.top, width: g.width, height: g.height }; }
    else if (mode === 'mini') r = { left: st.right - 254, top: st.top + 66, width: 240, height: 150 };
    else { const w = Math.min(620, st.width - 28); r = { left: st.right - 14 - w, top: st.top + 70, width: w, height: Math.min(340, st.height - 90) }; }
    const sig = [r.left, r.top, r.width, r.height].map(Math.round).join(',');
    if (box.dataset.rect === sig) return;
    box.dataset.rect = sig;
    Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  }
  /** Approximate text width (px) for 10–12px UI fonts: wide glyphs (CJK) count double. */
  function textW(str, size) {
    let w = 0;
    for (const ch of String(str || '')) w += /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? size * 1.0 : size * 0.6;
    return w;
  }
  /** Layered graph layout tuned for legibility: crossing-reduced ordering, spread ports,
   *  label-aware column gaps, and collision-avoiding edge labels on opaque pills. */
  function graphSvg(g) {
    const nodes = g.nodes.map((n) => ({ ...n }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = g.edges.filter((e) => byId.has(e.from) && byId.has(e.to) && e.from !== e.to).map((e, k) => ({ ...e, k }));
    // 1. layers: longest path from sources
    nodes.forEach((n) => (n.layer = 0));
    for (let it = 0; it < nodes.length; it++) {
      let changed = false;
      for (const e of edges) { const a = byId.get(e.from), b = byId.get(e.to); if (b.layer < a.layer + 1 && a.layer + 1 < nodes.length) { b.layer = a.layer + 1; changed = true; } }
      if (!changed) break;
    }
    const layers = [];
    for (const n of nodes) (layers[n.layer] = layers[n.layer] || []).push(n);
    for (let L = 0; L < layers.length; L++) layers[L] = layers[L] || [];
    // 2. order within layers: barycentre sweeps down and up to reduce crossings
    const order = () => layers.forEach((ls) => ls.forEach((n, i) => (n.ord = i)));
    order();
    for (let sweep = 0; sweep < 4; sweep++) {
      const down = sweep % 2 === 0;
      for (let L = down ? 1 : layers.length - 2; down ? L < layers.length : L >= 0; L += down ? 1 : -1) {
        for (const n of layers[L]) {
          const nb = edges.filter((e) => (down ? e.to === n.id : e.from === n.id)).map((e) => byId.get(down ? e.from : e.to)).filter((m) => m.layer === L + (down ? -1 : 1));
          n.bc = nb.length ? nb.reduce((a, m) => a + m.ord, 0) / nb.length : n.ord;
        }
        layers[L].sort((a, b) => a.bc - b.bc || a.ord - b.ord);
        order();
      }
    }
    // 3. geometry: node sizes, label-aware column gaps
    const nh = 44;
    for (const n of nodes) n.w = Math.max(96, Math.min(260, Math.max(textW(n.label || n.id, 12) + 28, textW(n.sub, 10) + 24)));
    const colW = layers.map((ls) => Math.max(96, ...ls.map((n) => n.w)));
    const gapAfter = layers.map((_, L) => {
      const lab = edges.filter((e) => byId.get(e.from).layer === L && byId.get(e.to).layer > L).map((e) => (e.label ? textW(e.label, 10) + 16 : 0));
      return Math.max(64, (lab.length ? Math.max(...lab) : 0) + 40);
    });
    const maxRows = Math.max(...layers.map((l) => l.length));
    const crowd = edges.length / Math.max(1, nodes.length);
    const gapY = crowd > 1.2 ? 30 : 22;
    let x = 12;
    layers.forEach((ls, L) => { ls.forEach((n, i) => { n.x = x + (colW[L] - n.w) / 2; n.y = 30 + i * (nh + gapY); }); x += colW[L] + (L < layers.length - 1 ? gapAfter[L] : 0); });
    const width = x + 12, height = 30 + maxRows * (nh + gapY) - gapY + 30;
    layers.forEach((ls) => { const h = ls.length * (nh + gapY) - gapY; for (const n of ls) n.y += (height - 60 - h) / 2; });
    // 4. ports: spread each node's outgoing / incoming edges along its height, in target / source order
    const fwd = edges.filter((e) => byId.get(e.to).layer > byId.get(e.from).layer);
    for (const n of nodes) {
      const outs = fwd.filter((e) => e.from === n.id).sort((a, b) => byId.get(a.to).y - byId.get(b.to).y);
      outs.forEach((e, i) => (e.y1 = n.y + nh * (i + 1) / (outs.length + 1)));
      const ins = fwd.filter((e) => e.to === n.id).sort((a, b) => byId.get(a.from).y - byId.get(b.from).y);
      ins.forEach((e, i) => (e.y2 = n.y + nh * (i + 1) / (ins.length + 1)));
    }
    // 5. paths + labels with collision avoidance
    const boxes = nodes.map((n) => ({ x: n.x - 4, y: n.y - 4, w: n.w + 8, h: nh + 8 }));
    const hit = (b) => boxes.some((o) => b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h);
    const bez = (P, t) => { const u = 1 - t; return [0, 1].map((k) => u * u * u * P[0][k] + 3 * u * u * t * P[1][k] + 3 * u * t * t * P[2][k] + t * t * t * P[3][k]); };
    let out = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" style="--w:${width}px" xmlns="http://www.w3.org/2000/svg" role="img"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>`;
    const labels = [];
    edges.forEach((e) => {
      const a = byId.get(e.from), b = byId.get(e.to);
      let P;
      if (b.layer > a.layer) {
        const x1 = a.x + a.w, y1 = e.y1 ?? a.y + nh / 2, x2 = b.x - 2, y2 = e.y2 ?? b.y + nh / 2, c = Math.max(24, (x2 - x1) * 0.5);
        P = [[x1, y1], [x1 + c, y1], [x2 - c, y2], [x2, y2]];
      } else { // same layer or backwards: arc over the top
        const x1 = a.x + a.w / 2, y1 = a.y, x2 = b.x + b.w / 2, y2 = b.y - 2, top = Math.min(y1, y2) - 28 - Math.abs(x2 - x1) * 0.08;
        P = [[x1, y1], [x1, top], [x2, top], [x2, y2]];
      }
      const d = `M${P[0][0]} ${P[0][1]} C${P[1][0]} ${P[1][1]} ${P[2][0]} ${P[2][1]} ${P[3][0]} ${P[3][1]}`;
      let lbl = '';
      if (e.label) {
        const lw = textW(e.label, 10) + 12, lh = 16;
        let best = null;
        for (const t of [0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8]) {
          const [cx, cy] = bez(P, t);
          for (const dy of [0, -11, 11]) {
            const box = { x: cx - lw / 2, y: cy - lh / 2 + dy, w: lw, h: lh };
            if (!hit(box)) { best = box; break; }
          }
          if (best) break;
        }
        if (!best) { const [cx, cy] = bez(P, 0.5); best = { x: cx - lw / 2, y: cy - lh / 2, w: lw, h: lh }; }
        boxes.push({ x: best.x - 3, y: best.y - 2, w: best.w + 6, h: best.h + 4 });
        lbl = `<g class="lbl"><rect x="${best.x.toFixed(1)}" y="${best.y.toFixed(1)}" width="${lw.toFixed(1)}" height="${lh}" rx="8"/><text x="${(best.x + lw / 2).toFixed(1)}" y="${(best.y + 11.5).toFixed(1)}" text-anchor="middle">${esc(e.label)}</text></g>`;
      }
      labels.push(`<g class="g-edge${e.style === 'dashed' ? ' dashed' : ''}" data-from="${esc(e.from)}" data-to="${esc(e.to)}" style="--i:${e.k + nodes.length}"><path d="${d}" marker-end="url(#ah)" pathLength="1"/>${lbl}</g>`);
    });
    // edges first (under nodes), labels drawn with their edge so highlight toggles them together
    out += labels.join('');
    nodes.forEach((n, k) => {
      const status = n.status || (n.file && IR.files[n.file] ? IR.files[n.file].status : 'context');
      out += `<g class="g-node ${status}" data-id="${esc(n.id)}"${n.file ? ` data-file="${esc(n.file)}"` : ''} style="--i:${k}"><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${nh}" rx="7"/><text x="${n.x + n.w / 2}" y="${n.y + (n.sub ? 18 : 27)}" text-anchor="middle">${esc(n.label || n.id)}</text>${n.sub ? `<text class="sub" x="${n.x + n.w / 2}" y="${n.y + 34}" text-anchor="middle">${esc(n.sub)}</text>` : ''}</g>`;
    });
    return out + '</svg>';
  }
  function renderChrome(s) {
    $('.ctrl-btns .play').innerHTML = playing ? ICON.pause : ICON.play;
    app.classList.toggle('paused-at-end', atSceneEnd && !playing);
    app.classList.toggle('playing', playing);
    $('.time').textContent = `${fmt(T)} / ${fmt(total)}`;
    for (const c of chSpans) c.fill.style.width = `${clamp((T - c.t0) / (c.t1 - c.t0), 0, 1) * 100}%`;
    $('.scrub .knob').style.left = `${(T / total) * 100}%`;
    $('.scrub').setAttribute('aria-valuenow', String(Math.round((T / total) * 100)));
    const hint = $('.ctrl-hint');
    const msg = atSceneEnd && !playing ? `<span class="cont">${T_('장면 끝 — Space로 다음 장면', 'End of scene — Space to continue')}</span>` : '';
    const sig = msg + (userOps.length ? 'u' : '');
    if (hint.dataset.sig !== sig) {
      hint.dataset.sig = sig;
      hint.innerHTML = `${msg}<span><kbd>Space</kbd> ${T_('재생/정지', 'play/pause')}</span><span><kbd>←</kbd><kbd>→</kbd> ${T_('장면 이동', 'scene')}</span><span><kbd>⇧</kbd>+<kbd>←</kbd><kbd>→</kbd> ±5s</span><span><kbd>[</kbd><kbd>]</kbd> ${T_('배속', 'speed')}</span><span>⌘/Ctrl+${T_('클릭: 정의로 이동', 'Click: definition')}</span>${userOps.length ? `<span class="cont">${T_('탐색 모드 — 재생하면 장면으로 돌아갑니다', 'Exploring — play to return to the walkthrough')}</span>` : ''}`;
    }
  }

  // ================================================================== playback
  let raf = 0, lastTs = 0;
  function tick(ts) {
    if (!playing) return;
    const dt = lastTs ? Math.min(100, ts - lastTs) : 16;
    lastTs = ts;
    const k = sceneAt(T);
    const end = scenes[k].t0 + scenes[k].duration;
    const next = T + dt * speed;
    if (segPause && T < end && next >= end && k < scenes.length - 1) { T = end - 0.5; playing = false; atSceneEnd = true; render(); return; }
    if (next >= total) { T = total; playing = false; render(); return; }
    T = next;
    render();
    raf = requestAnimationFrame(tick);
  }
  function play() {
    if (T >= total) seek(0);
    if (atSceneEnd) { T = Math.min(total, Math.ceil(T + 1)); atSceneEnd = false; }
    started = true;
    userOps = [];
    playing = true; lastTs = 0;
    cancelAnimationFrame(raf); raf = requestAnimationFrame(tick);
    render();
  }
  function pause() { playing = false; cancelAnimationFrame(raf); render(); }
  function seek(t, keepPlaying) {
    T = clamp(t, 0, total); atSceneEnd = false; userOps = []; started = true;
    if (!keepPlaying) playing = false;
    render();
  }
  function gotoScene(k, autoplay) {
    k = clamp(k, 0, scenes.length - 1);
    seek(scenes[k].t0 + 1);
    if (autoplay) play();
  }

  // ================================================================== interaction
  function exploreOpen(file, opt) {
    if (playing) pause();
    started = true;
    opt = opt || {};
    userOps.push((s) => {
      const pi = opt.pane != null ? opt.pane : s.active;
      const pane = showFile(s, pi, file, opt.view);
      if (opt.line && IR.files[file]) {
        const r = { side: opt.side || (pane.view === 'before' ? 'before' : 'after'), from: opt.line, to: opt.line };
        pane.scroll = { to: r, mode: 'center', p: 1, prev: null };
        pane.hl.push({ ...r, tone: 'focus', p: 1, key: 'u' });
        pane.flash = { ...r, key: 'u' + userOps.length };
      }
    });
    render();
  }
  app.addEventListener('click', (ev) => {
    const t = ev.target.closest('button, [data-file], [data-dir], [data-fold], .row');
    if (!t) return;
    const act = t.dataset && t.dataset.act;
    if (act === 'play') return playing ? pause() : play();
    if (act === 'prev') return gotoScene(sceneAt(T) - (T - scenes[sceneAt(T)].t0 < 1500 ? 1 : 0), playing);
    if (act === 'next') return gotoScene(sceneAt(T) + 1, playing);
    if (act === 'restart') return gotoScene(0, true);
    if (act === 'explorer') return toggleExplorer();
    if (act === 'guide') { app.classList.toggle('hide-guide'); return settle(); }
    if (act === 'ex-filter') { ex.filter = !ex.filter; t.classList.toggle('on', ex.filter); ex.version = (ex.version || 0) + 1; return render(); }
    if (act === 'ex-collapse') { ex.expanded.clear(); ex.revealed = '\0'; ex.version = (ex.version || 0) + 1; ex.prevVisible = new Set(); return render(); }
    if (act === 'theme') { const r = document.documentElement; const cur = r.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); r.dataset.theme = cur === 'light' ? 'dark' : 'light'; try { localStorage.setItem('wt-theme', r.dataset.theme); } catch (e) { /* ignore */ } return; }
    if (act === 'help') return toggleHelp();
    if (act === 'graph-close') {
      if ($('.wt-graph').dataset.src === 'map') { mapUi.shown = false; mapUi.expanded = false; return render(); }
      if (playing) pause(); userOps.push((s) => { s.graph = null; }); return render();
    }
    if (act === 'map') { mapUi.shown = !mapUi.shown; mapUi.expanded = false; return render(); }
    if (act === 'map-toggle') { mapUi.expanded = !mapUi.expanded; mapUi.shown = true; return render(); }
    if (t.dataset.sec) { const sec = t.closest('.gd-sec'); const open = !sec.classList.contains('open'); sec.classList.toggle('open', open); guide.sec[t.dataset.sec + 'Pinned'] = open; return; }
    if (t.dataset.scene) return gotoScene(Number(t.dataset.scene), false);
    if (t.dataset.dir != null && t.classList.contains('ex-row')) {
      const d = t.dataset.dir;
      if (ex.expanded.has(d)) ex.expanded.delete(d); else ex.expanded.add(d);
      ex.version = (ex.version || 0) + 1;
      return render();
    }
    if (t.dataset.fold != null) {
      const P = paneEls.find((x) => x.code.contains(t));
      if (P && P.model) { const list = P.userExpanded.get(P.model.key) || []; list.push(Number(t.dataset.fold)); P.userExpanded.set(P.model.key, list); P.viewKey = ''; render(); }
      return;
    }
    if (t.dataset.view && t.dataset.pane) {
      const pi = Number(t.dataset.pane), v = t.dataset.view;
      if (playing) pause();
      userOps.push((s) => { const p = s.panes[pi]; if (v === 'unified' || v === 'split') { p.view = 'diff'; p.diff.mode = v; } else p.view = v; });
      return render();
    }
    if (t.dataset.file) return exploreOpen(t.dataset.file, { pane: t.dataset.pane != null ? Number(t.dataset.pane) : undefined, line: t.dataset.line ? Number(t.dataset.line) : null, side: t.dataset.side, view: t.dataset.view });
    if (t.classList.contains('row') && (ev.metaKey || ev.ctrlKey)) {
      const word = wordAt(ev);
      if (word) { const def = findDefinition(word); if (def) exploreOpen(def.file, { line: def.line, side: 'after', view: 'after' }); }
    }
  });
  function toggleExplorer() {
    if (matchMedia('(max-width: 1000px)').matches) app.classList.toggle('show-explorer');
    else app.classList.toggle('hide-explorer');
    settle();
  }
  /** Re-measure after a panel slides (layout-dependent overlays follow). */
  function settle() { const again = () => { $('.wt-graph').dataset.rect = ''; for (const P of paneEls) P.scrollSig = ''; render(); }; again(); setTimeout(again, 320); }
  function wordAt(ev) {
    let node, off;
    if (document.caretPositionFromPoint) { const c = document.caretPositionFromPoint(ev.clientX, ev.clientY); if (c) { node = c.offsetNode; off = c.offset; } }
    else if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(ev.clientX, ev.clientY); if (r) { node = r.startContainer; off = r.startOffset; } }
    if (!node || node.nodeType !== 3) return null;
    const s = node.textContent;
    let a = off, b = off;
    while (a > 0 && /[\w$]/.test(s[a - 1])) a--;
    while (b < s.length && /[\w$]/.test(s[b])) b++;
    return s.slice(a, b) || null;
  }
  function findDefinition(word) {
    const re = new RegExp(`(?:\\b(?:function|class|def|fn|func|fun|interface|type|struct|enum|trait|const|let|var|val|module|object)\\s+\\*?\\s*${word}\\b)|(?:^\\s*(?:export\\s+)?(?:async\\s+)?${word}\\s*[=:(]\\s*(?:async\\s*)?\\(?)`);
    for (const [p, f] of Object.entries(IR.files)) {
      const text = f.after != null ? f.after : f.before;
      if (!text) continue;
      const lines = D.splitLines(text);
      for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return { file: p, line: i + 1 };
    }
    return null;
  }

  // scrubber
  const scrub = $('.scrub');
  const tFromX = (x) => { const r = scrub.getBoundingClientRect(); return clamp((x - r.left) / r.width, 0, 1) * total; };
  let dragging = false, wasPlaying = false;
  scrub.addEventListener('pointerdown', (e) => { dragging = true; wasPlaying = playing; scrub.setPointerCapture(e.pointerId); seek(tFromX(e.clientX)); });
  scrub.addEventListener('pointermove', (e) => {
    const t = tFromX(e.clientX);
    const tip = scrub.querySelector('.tip');
    const sc = scenes[sceneAt(t)];
    tip.textContent = `${sceneAt(t) + 1}. ${sc.title || ''} · ${fmt(t)}`;
    tip.style.left = `${(t / total) * 100}%`;
    if (dragging) seek(t);
  });
  scrub.addEventListener('pointerup', () => { dragging = false; if (wasPlaying) play(); });
  scrub.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); seek(T + (e.key === 'ArrowLeft' ? -5000 : 5000), playing); } });

  $('[data-act="speed"]').addEventListener('change', (e) => { speed = Number(e.target.value); });
  $('[data-act="segpause"]').addEventListener('change', (e) => { segPause = e.target.checked; });

  function setSpeed(dir) {
    const sel = $('[data-act="speed"]');
    const opts = Array.from(sel.options).map((o) => Number(o.value));
    const i = clamp(opts.indexOf(speed) + dir, 0, opts.length - 1);
    speed = opts[i]; sel.value = String(speed);
  }
  function toggleHelp() {
    const exi = document.querySelector('.help');
    if (exi) { exi.remove(); return; }
    const box = el('div', 'help', `<div role="dialog" aria-label="shortcuts"><h2>${T_('단축키', 'Keyboard shortcuts')}</h2><table>
      <tr><td><kbd>Space</kbd> / <kbd>K</kbd></td><td>${T_('재생 / 일시정지', 'Play / pause')}</td></tr>
      <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>${T_('이전 / 다음 장면', 'Previous / next scene')}</td></tr>
      <tr><td><kbd>⇧</kbd>+<kbd>←</kbd> <kbd>→</kbd></td><td>${T_('5초 뒤로 / 앞으로', 'Seek ±5s')}</td></tr>
      <tr><td><kbd>[</kbd> <kbd>]</kbd></td><td>${T_('배속 낮추기 / 높이기', 'Slower / faster')}</td></tr>
      <tr><td><kbd>P</kbd></td><td>${T_('장면마다 멈춤 켜기/끄기', 'Toggle pause per scene')}</td></tr>
      <tr><td><kbd>1</kbd>–<kbd>9</kbd></td><td>${T_('N번째 챕터로 이동', 'Jump to chapter N')}</td></tr>
      <tr><td><kbd>B</kbd> / <kbd>G</kbd> / <kbd>M</kbd></td><td>${T_('탐색기 / 워크스루 패널 / 구조 지도', 'Explorer / walkthrough panel / structure map')}</td></tr>
      <tr><td>⌘/Ctrl + ${T_('클릭', 'Click')}</td><td>${T_('식별자의 정의로 이동 (일시정지 중)', 'Go to definition (while paused)')}</td></tr>
      </table></div>`);
    box.addEventListener('click', (e) => { if (e.target === box) box.remove(); });
    document.body.appendChild(box);
  }
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, select, textarea')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === ' ' || k === 'k' || k === 'K') { e.preventDefault(); playing ? pause() : play(); }
    else if (k === 'ArrowRight' && e.shiftKey) seek(T + 5000, playing);
    else if (k === 'ArrowLeft' && e.shiftKey) seek(T - 5000, playing);
    else if (k === 'ArrowRight') gotoScene(sceneAt(T) + 1, playing);
    else if (k === 'ArrowLeft') gotoScene(sceneAt(T) - (T - scenes[sceneAt(T)].t0 < 1500 ? 1 : 0), playing);
    else if (k === ']') setSpeed(1);
    else if (k === '[') setSpeed(-1);
    else if (k === 'p' || k === 'P') { segPause = !segPause; $('[data-act="segpause"]').checked = segPause; }
    else if (k === 'b' || k === 'B') toggleExplorer();
    else if (k === 'g' || k === 'G') { app.classList.toggle('hide-guide'); settle(); }
    else if (k === 'm' || k === 'M') { mapUi.shown = !mapUi.shown; mapUi.expanded = false; render(); }
    else if (k === '?') toggleHelp();
    else if (k === 'Escape') { const h = document.querySelector('.help'); if (h) h.remove(); }
    else if (/^[1-9]$/.test(k)) { const ci = Number(k) - 1; const sc = scenes.findIndex((x) => x.ci === ci); if (sc >= 0) gotoScene(sc, playing); }
  });
  window.addEventListener('resize', () => { for (const P of paneEls) { P.scrollSig = ''; P.typSig = ''; } $('.wt-graph').dataset.rect = ''; render(); });

  try { const th = localStorage.getItem('wt-theme'); if (th) document.documentElement.dataset.theme = th; } catch (e) { /* ignore */ }
  const hash = /scene=([^&]+)/.exec(location.hash);
  if (hash) { const v = decodeURIComponent(hash[1]); const i = scenes.findIndex((x, n) => x.id === v || String(n + 1) === v); if (i >= 0) { started = true; T = scenes[i].t0 + 1; } }
  app.removeAttribute('aria-busy');
  render();
  window.__walkthrough = { scenes, total, seek, play, pause, stateAt, get T() { return T; } };
})();
