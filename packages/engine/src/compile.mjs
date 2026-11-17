// Engine compiler: authoring IR -> compiled IR.
// Validates the IR, resolves sources (git or inline), resolves anchors to
// concrete lines and embeds file contents. Pure library: no process exits,
// no console output. The player only ever sees compiled IR.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from './lib/git.mjs';
import * as L from './lib/lang.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PLAYER_DIR = path.join(HERE, '..', 'player');
export const IR_VERSION = 1;
new Function(fs.readFileSync(path.join(PLAYER_DIR, 'diff.js'), 'utf8'))();
new Function(fs.readFileSync(path.join(PLAYER_DIR, 'timing.js'), 'utf8'))();
const WalkDiff = globalThis.WalkDiff;
const WalkTiming = globalThis.WalkTiming;

/**
 * @param <class 'object'> input   authoring IR (not mutated)
 * @param {repo?: string, baseDir?: string, extraFiles?: boolean} opts
 * @returns {ok: boolean, ir: object, errors: {path,message}[], warnings: {path,message}[], stats: object}
 */
export function compile(input, opts = {}) {
  const ir = JSON.parse(JSON.stringify(input));
  const errors = [];
  const warnings = [];
  const err = (where, msg) => errors.push({ path: where, message: msg });
  const warn = (where, msg) => warnings.push({ path: where, message: msg });

  // ---------------------------------------------------------------- sources
  if (ir.version !== 1) warn('version', `expected 1, got ${ir.version}`);
  const src = ir.source || {};
  let repo = opts.repo || (src.repo ? path.resolve(opts.baseDir || process.cwd(), src.repo) : null);
  let range = null;
  if (repo) {
    try {
      repo = G.repoRoot(path.resolve(repo));
      range = G.resolveRange(repo, { range: src.range, base: src.base, head: src.head });
    } catch (e) { err('source', e.message); }
  }
  ir.files = ir.files || {};

  // include every changed file so the viewer can explore beyond the narrated path
  if (range && opts.extraFiles !== false) {
    for (const f of G.changedFiles(repo, range)) {
      if (!ir.files[f.path]) ir.files[f.path] = { status: f.status, oldPath: f.oldPath, unnarrated: true };
      else if (!ir.files[f.path].status) ir.files[f.path].status = f.status;
      if (f.oldPath && !ir.files[f.path].oldPath) ir.files[f.path].oldPath = f.oldPath;
    }
  }

  // auto-register files referenced by steps but missing from `files`
  walkSteps((step) => {
    for (const file of stepFiles(step)) if (file && !ir.files[file]) { ir.files[file] = { status: 'context' }; warn('files', `"${file}" used in steps but not declared: added as context`); }
  });

  const MAX_BYTES = 600_000;
  for (const [p, f] of Object.entries(ir.files)) {
    f.status = f.status || 'context';
    f.language = f.language || L.detectLanguage(p);
    if (f.before === undefined) f.before = f.status === 'added' ? null : range ? G.readAt(repo, range.base, f.oldPath || p) : null;
    if (f.after === undefined) f.after = f.status === 'deleted' ? null : range ? G.readAt(repo, range.head, p) : null;
    if (f.status === 'context') {
      if (f.after == null && f.before != null) f.after = f.before;
      if (f.before == null && f.after != null) f.before = f.after;
    }
    if (f.before == null && f.after == null) {
      if (L.isGeneratedFile(p) || f.unnarrated) { delete ir.files[p]; continue; }
      err(`files["${p}"]`, 'content not found (check path, source.base/head, or provide before/after inline)');
    }
    for (const side of ['before', 'after']) {
      if (f[side] && f[side].length > MAX_BYTES) {
        if (f.unnarrated) { delete ir.files[p]; break; }
        warn(`files["${p}"]`, `${side} is ${(f[side].length / 1024) | 0}KB: consider narrating a smaller file`);
      }
    }
  }

  // ---------------------------------------------------------------- anchors
  const linesCache = new Map();
  function linesOf(file, side) {
    const key = file + '\0' + side;
    if (!linesCache.has(key)) {
      const t = ir.files[file] && ir.files[file][side];
      linesCache.set(key, t == null ? null : WalkDiff.splitLines(t));
    }
    return linesCache.get(key);
  }
  const diffCache = new Map();
  function changeBlocks(file) {
    if (!diffCache.has(file)) {
      const f = ir.files[file];
      const { rows } = WalkDiff.compute(f.before, f.after, { algorithm: 'patience' });
      const blocks = [];
      let cur = null;
      rows.forEach((r) => {
        if (r.type === 'eq') { cur = null; return; }
        if (!cur) { cur = { oldFrom: null, oldTo: null, newFrom: null, newTo: null }; blocks.push(cur); }
        if (r.old) { cur.oldFrom = cur.oldFrom ?? r.old; cur.oldTo = r.old; }
        if (r.new) { cur.newFrom = cur.newFrom ?? r.new; cur.newTo = r.new; }
      });
      diffCache.set(file, blocks);
    }
    return diffCache.get(file);
  }

  function defaultSide(file, view) {
    const f = ir.files[file];
    if (view === 'before') return 'before';
    if (f && f.after == null) return 'before';
    return 'after';
  }

  /** What a `type` step will animate: characters of added lines (leading whitespace excluded) and removed lines in range. */
  function typedText(file, view, r) {
    const f = ir.files[file];
    const plainAll = view === 'after' && (f.status === 'added' || f.status === 'context' || f.before == null);
    if (f.after == null) { // a deleted file: every line goes
      return { chars: 0, dels: (linesOf(file, 'before') || []).slice(r.from - 1, r.to).length, lines: 0 };
    }
    let chars = 0, dels = 0, lines = 0;
    if (view === 'after' && plainAll) {
      for (const l of (linesOf(file, 'after') || []).slice(r.from - 1, r.to)) { chars += l.trim().length; lines++; }
      return { chars, dels, lines };
    }
    const { rows } = WalkDiff.compute(f.before, f.after, { algorithm: 'patience' });
    // the row span covered by the range (contiguous, so removed lines in between are included)
    const key = r.side === 'before' ? 'old' : 'new';
    const idx = rows.map((x, i) => (x[key] >= r.from && x[key] <= r.to ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return { chars, dels, lines };
    for (const x of rows.slice(idx[0], idx[idx.length - 1] + 1)) {
      if (x.type === 'add' || (x.type === 'mod' && !x.ws)) { chars += x.newText.trim().length; lines++; }
      if (x.type === 'del' || (x.type === 'mod' && !x.ws)) dels++;
    }
    return { chars, dels, lines };
  }

  function suggest(anchor, file, side, re) {
    const other = side === 'after' ? 'before' : 'after';
    const test = (l) => (re ? re.test(l) : l.includes(anchor.find));
    const ol = linesOf(file, other);
    if (ol) { const i = ol.findIndex(test); if (i >= 0) return `, but it is on the ${other} side (line ${i + 1}); add "side": "${other}" and use a view that shows it`; }
    if (!re && anchor.find) {
      const norm = (x) => x.replace(/\s+/g, ' ').trim().toLowerCase();
      const want = norm(anchor.find);
      const ls = linesOf(file, side) || [];
      const i = ls.findIndex((l) => norm(l).includes(want));
      if (i >= 0) return `: near match (whitespace/case differs) at line ${i + 1}: ${ls[i].trim().slice(0, 80)}`;
      if (anchor.find.includes('\n')) return ': "find" matches within a single line; use "span" or "block" for multi-line ranges';
    }
    return '';
  }

  /** Resolve a range anchor → {side, from, to}. */
  function resolveRange(anchor, file, view, where) {
    if (anchor === undefined || anchor === null) return null;
    let side = (anchor && anchor.side) || defaultSide(file, view);
    const lines = () => linesOf(file, side);
    const check = (from, to) => {
      const ls = lines();
      if (!ls) { err(where, `"${file}" has no ${side} version`); return null; }
      if (!(from >= 1 && to >= from && to <= ls.length)) { err(where, `lines ${from}-${to} out of range for ${file} (${side}, ${ls.length} lines)`); return null; }
      return { side, from, to };
    };
    if (typeof anchor === 'number') return check(anchor, anchor);
    if (Array.isArray(anchor)) return check(anchor[0], anchor[1] ?? anchor[0]);
    if (typeof anchor !== 'object') { err(where, `bad anchor ${JSON.stringify(anchor)}`); return null; }
    if (anchor.line !== undefined) return check(anchor.line, anchor.line + (anchor.span ? anchor.span - 1 : 0));
    if (anchor.lines) return check(anchor.lines[0], anchor.lines[1] ?? anchor.lines[0]);
    if (anchor.find !== undefined || anchor.regex !== undefined) {
      const ls = lines();
      if (!ls) { err(where, `"${file}" has no ${side} version`); return null; }
      const re = anchor.regex !== undefined ? new RegExp(anchor.regex) : null;
      const nth = anchor.nth || 1;
      const matchLine = (l) => (re ? re.test(l) : l.includes(anchor.find));
      if (!anchor.nth) {
        const all = [];
        for (let i = 0; i < ls.length; i++) if (matchLine(ls[i])) all.push(i + 1);
        if (all.length > 1) warn(where, `ambiguous anchor: ${re ? 'regex' : 'text'} ${JSON.stringify(anchor.find ?? anchor.regex)} matches ${all.length} lines in ${file} (${side}): lines ${all.slice(0, 6).join(', ')}${all.length > 6 ? ', …' : ''}; using ${all[0]}. Add "nth" or use a more specific string`);
      }
      let seen = 0;
      for (let i = 0; i < ls.length; i++) {
        if (re ? re.test(ls[i]) : ls[i].includes(anchor.find)) {
          if (++seen === nth) {
            if (anchor.block) { const end = L.blockEnd(ls, i, ir.files[file].language); return check(i + 1, end + 1); }
            return check(i + 1, Math.min(ls.length, i + (anchor.span || 1)));
          }
        }
      }
      err(where, `${re ? 'regex' : 'text'} ${JSON.stringify(anchor.find ?? anchor.regex)}${nth > 1 ? ` (nth ${nth})` : ''} not found in ${file} (${side})${suggest(anchor, file, side, re)}`);
      return null;
    }
    if (anchor.symbol) {
      const ls = lines();
      if (!ls) { err(where, `"${file}" has no ${side} version`); return null; }
      const syms = L.extractSymbols(ls.join('\n'), ir.files[file].language).filter((s) => s.name === anchor.symbol);
      if (!syms.length) {
        // fallback: first line that declares-ish the name
        const i = ls.findIndex((l) => new RegExp(`\\b${escapeRe(anchor.symbol)}\\b`).test(l));
        if (i >= 0) { warn(where, `symbol "${anchor.symbol}" not recognised as a definition in ${file}; using first occurrence (line ${i + 1})`); return check(i + 1, i + 1); }
        err(where, `symbol "${anchor.symbol}" not found in ${file} (${side})`); return null;
      }
      const s = syms[(anchor.nth || 1) - 1] || syms[0];
      return check(s.line, anchor.head ? s.line : s.endLine);
    }
    if (anchor.hunk !== undefined) {
      const blocks = changeBlocks(file);
      const b = blocks[anchor.hunk - 1];
      if (!b) { err(where, `hunk ${anchor.hunk} does not exist in ${file} (${blocks.length} change blocks)`); return null; }
      if (anchor.side === 'before' || b.newFrom == null) { side = 'before'; return check(b.oldFrom, b.oldTo); }
      side = 'after';
      return check(b.newFrom, b.newTo);
    }
    err(where, `unrecognised anchor ${JSON.stringify(anchor)}`);
    return null;
  }
  function resolvePoint(anchor, file, view, where) {
    const r = resolveRange(anchor, file, view, where);
    return r && { side: r.side, line: r.from, to: r.to };
  }

  // ---------------------------------------------------------------- steps
  const KNOWN = new Set(['open', 'layout', 'diffView', 'reveal', 'highlight', 'focus', 'unfocus', 'note', 'type', 'replay', 'goto', 'refs', 'graph', 'say', 'wait', 'clear', 'close']);
  const VIEWS = new Set(['after', 'before', 'diff']);
  const panes = [{ file: null, view: 'after', tabs: new Set() }, { file: null, view: 'after', tabs: new Set() }];
  const setPane = (p, file, view) => { panes[p].tabs.add(file); panes[p].file = file; panes[p].view = view; };
  let active = 0;
  const sceneIds = new Set();
  let gi = 0; // global scene index
  const realFiles = [null, null]; // what each pane really shows at runtime (tour included)

  expandTour();

  (ir.chapters || []).forEach((ch, ci) => {
    if (!ch.title) warn(`chapters[${ci}]`, 'missing title');
    if ((ch.scenes || []).filter((x) => !x.auto).length > 7) warn(`chapters[${ci}]`, `${ch.scenes.length} scenes: consider splitting the chapter (chunking: ≤ ~5–7 units)`);
    (ch.scenes || []).forEach((sc, si) => {
      const W = `chapters[${ci}].scenes[${si}]${sc.id ? `(${sc.id})` : ''}`;
      if (!sc.id) sc.id = `c${ci + 1}s${si + 1}`;
      if (sceneIds.has(sc.id)) err(W, `duplicate scene id "${sc.id}"`);
      sceneIds.add(sc.id);
      if (!sc.auto) {
        if (!sc.narration) warn(W, 'no narration');
        if (!sc.question) warn(W, 'no "question": state what the viewer is wondering at this point (shown above the code all scene long)');
        if (gi > 0 && !sc.bridge) warn(W, 'no "bridge": say why this scene follows the previous one (shown on the transition card)');
        gi++;
      }
      if (sc.narration && sc.narration.length > 600) warn(W, `narration is ${sc.narration.length} chars: split the scene (segmenting principle)`);
      if ((sc.steps || []).length > 12) warn(W, `${sc.steps.length} steps: a scene should carry one idea`);
      // Tour segments must not change what the author's steps assume is open: resolve them, then
      // restore the author's pane state (tabs stay, since they are real at runtime).
      const snap = sc.auto ? { panes: panes.map((x) => ({ file: x.file, view: x.view })), active } : null;
      // An author scene that continues in a file the tour has since left: go back to it visibly
      // (a tab click), instead of switching files with no cause on screen.
      if (!sc.auto && (sc.steps || []).length) {
        const p0 = sc.steps[0].pane !== undefined ? (sc.steps[0].pane ? 1 : 0) : active;
        const first = sc.steps[0];
        const explicit = ['open', 'goto', 'layout', 'graph', 'refs'].includes(first.do) || first.file;
        if (!explicit && panes[p0].file && realFiles[p0] && panes[p0].file !== realFiles[p0]) sc.steps.unshift({ do: 'open', file: panes[p0].file, view: panes[p0].view, pane: p0, noReveal: true });
      }
      (sc.steps || []).forEach((st, ti) => resolveStep(st, `${W}.steps[${ti}]`));
      panes.forEach((x, i) => { realFiles[i] = x.file; });
      if (snap) { panes.forEach((x, i) => { x.file = snap.panes[i].file; x.view = snap.panes[i].view; }); active = snap.active; }
      const items = WalkTiming.narrationItems(sc.narration || '');
      (sc.steps || []).forEach((st, ti) => {
        if (st.cue === undefined) return;
        if (!Number.isInteger(st.cue) || st.cue < 1 || st.cue > items.length) err(`${W}.steps[${ti}]`, `cue ${JSON.stringify(st.cue)} must be 1..${items.length} (the narration has ${items.length} sentence/bullet item${items.length === 1 ? '' : 's'})`);
      });
    });
  });
  if (!(ir.chapters || []).length) err('chapters', 'no chapters');

  function paneOf(st) {
    if (st.pane !== undefined) { active = st.pane ? 1 : 0; }
    return active;
  }
  function useFile(st, W) {
    const p = paneOf(st);
    if (st.file) {
      if (!ir.files[st.file]) err(W, `unknown file "${st.file}"`);
      if (panes[p].file !== st.file) setPane(p, st.file, st.view || panes[p].view || 'after');
    }
    if (st.view) panes[p].view = st.view;
    if (!panes[p].file) { err(W, 'no file open in this pane: add "file" or an "open" step first'); return null; }
    return { p, file: panes[p].file, view: panes[p].view };
  }

  function resolveStep(st, W) {
    if (!KNOWN.has(st.do)) { err(W, `unknown action "${st.do}" (known: ${[...KNOWN].join(', ')})`); return; }
    if (st.view && !VIEWS.has(st.view)) err(W, `view must be one of after|before|diff`);
    switch (st.do) {
      case 'open': {
        const p = paneOf(st);
        if (!st.file || !ir.files[st.file]) { err(W, `unknown file "${st.file}"`); return; }
        const f = ir.files[st.file];
        const view = st.view || (f.status === 'context' || f.status === 'added' ? 'after' : f.status === 'deleted' ? 'before' : 'diff');
        st.view = view;
        // how the player navigates there: reveal + click in the explorer, click an open tab, or nothing
        st._openKind = panes[p].file === st.file ? 'same' : panes[p].tabs.has(st.file) ? 'tab' : 'tree';
        // a file with changes plays a top-to-bottom "diff reveal" after it opens
        st._reveal = !st.noReveal && st._openKind !== 'same' && view !== 'before' && f.status !== 'context' && !(view === 'after' && f.before == null && f.status !== 'added');
        setPane(p, st.file, view);
        if (view === 'after' && f.after == null) err(W, `${st.file} has no "after" version (deleted): use view "before" or "diff"`);
        if (view === 'before' && f.before == null) err(W, `${st.file} has no "before" version (added)`);
        if (st.at !== undefined) st._r = resolvePoint(st.at, st.file, view, W);
        else if (view !== 'before') {
          // land on the first change, not on line 1 (the code above it is unchanged context)
          const b = changeBlocks(st.file)[0];
          if (b) st._first = b.newFrom != null ? { side: 'after', from: b.newFrom, to: b.newTo } : { side: 'before', from: b.oldFrom, to: b.oldTo };
        }
        break;
      }
      case 'reveal': case 'highlight': case 'focus': case 'note': case 'type': case 'replay': {
        if (st.do === 'replay') st.range = { hunk: st.hunk || 1 };
        const u = useFile(st, W); if (!u) return;
        st._file = u.file; st._pane = u.p; st._view = u.view;
        const anchor = st.do === 'note' || st.do === 'reveal' ? st.at : (st.range ?? st.at);
        if (anchor === undefined) { err(W, `"${st.do}" needs ${st.do === 'note' || st.do === 'reveal' ? '"at"' : '"range"'}`); return; }
        st._r = resolveRange(anchor, u.file, u.view, W);
        if (st._r && u.view !== 'diff' && st._r.side !== (u.view === 'before' ? 'before' : 'after')) {
          err(W, `anchor is on the ${st._r.side} side but the pane shows "${u.view}": switch to view "diff" or "${st._r.side}"`);
        }
        if (st.do === 'replay' && st._r) {
          const t = typedText(u.file, u.view === 'before' ? 'diff' : u.view, st._r);
          st._chars = t.chars; st._dels = t.dels; st._lines = t.lines;
          const tempo = st.tempo || 'normal';
          if (!['key', 'normal', 'skim'].includes(tempo)) err(W, 'replay.tempo must be key|normal|skim');
          st._mode = tempo === 'skim' ? 'block' : tempo === 'key' && t.chars <= 700 ? 'type' : 'lines';
        }
        if (st.do === 'type' && st._r) {
          if (u.view === 'before') err(W, '"type" replays an edit: use view "diff" or "after"');
          const t = typedText(u.file, u.view, st._r);
          st._chars = t.chars; st._dels = t.dels;
          if (!t.chars && !t.dels) warn(W, 'type: the range contains no added or removed lines: nothing to animate');
          if (t.lines > 20) warn(W, `type: ${t.lines} lines to type: keep typing for small key edits (≤ ~15 lines); highlight larger blocks instead`);
        }
        if (st.do === 'note' && !st.text) err(W, 'note needs "text"');
        if (st.do === 'note' && st.text && st.text.length > 220) warn(W, 'note longer than 220 chars: keep inline notes short, put detail in narration');
        break;
      }
      case 'goto': {
        const from = st.from || {};
        const u = useFile({ ...from, pane: st.pane }, W); if (!u) return;
        st._pane = u.p;
        st._from = { file: u.file, ...(resolvePoint(from.at, u.file, u.view, W + '.from') || {}) };
        if (!from.token) err(W, 'goto.from needs "token" (the identifier that is Cmd+Clicked)');
        else if (st._from.line) {
          const text = linesOf(u.file, st._from.side)[st._from.line - 1] || '';
          if (!text.includes(from.token)) err(W, `token "${from.token}" not on ${u.file}:${st._from.line} (${st._from.side}): ${text.trim().slice(0, 80)}`);
        }
        const to = st.to || {};
        if (!to.file || !ir.files[to.file]) { err(W, `goto.to: unknown file "${to.file}"`); return; }
        const tp = to.pane !== undefined ? to.pane : u.p;
        const tf = ir.files[to.file];
        const tview = to.view || (tf.after == null ? 'before' : tf.status === 'context' ? 'after' : (panes[tp].file === to.file ? panes[tp].view : 'after'));
        const r = resolveRange(to.at ?? (from.token ? { symbol: from.token } : 1), to.file, tview, W + '.to');
        st._to = { file: to.file, pane: tp, view: tview, ...(r ? { side: r.side, line: r.from, from: r.from, to: r.to } : {}) };
        setPane(tp, to.file, tview);
        active = tp;
        break;
      }
      case 'refs': {
        if (!Array.isArray(st.items) || !st.items.length) { err(W, 'refs needs "items": [{file, at, label?}]'); return; }
        const p = paneOf(st);
        st._pane = p;
        st._items = st.items.map((it, i) => {
          if (!ir.files[it.file]) { err(`${W}.items[${i}]`, `unknown file "${it.file}"`); return null; }
          const f = ir.files[it.file];
          const view = it.view || (f.status === 'context' || f.status === 'added' ? 'after' : f.after == null ? 'before' : 'diff');
          const r = resolvePoint(it.at, it.file, view, `${W}.items[${i}]`);
          const text = r ? (linesOf(it.file, r.side) || [])[r.line - 1] : '';
          return r && { file: it.file, view, side: r.side, line: r.line, label: it.label || null, text: (text || '').trim().slice(0, 160) };
        }).filter(Boolean);
        const last = st._items[st._items.length - 1];
        for (const it of st._items) panes[p].tabs.add(it.file);
        if (last) setPane(p, last.file, last.view);
        break;
      }
      case 'graph': {
        if (st.hide) break;
        const ids = new Set((st.nodes || []).map((n) => n.id));
        for (const e of st.edges || []) if (!ids.has(e.from) || !ids.has(e.to)) { if (st.nodes) err(W, `edge ${e.from}→${e.to} references unknown node`); }
        for (const n of st.nodes || []) if (n.file && !ir.files[n.file]) warn(W, `graph node "${n.id}" points to unknown file "${n.file}"`);
        break;
      }
      case 'diffView': {
        paneOf(st);
        if (st.mode && !['unified', 'split'].includes(st.mode)) err(W, 'diffView.mode must be unified|split');
        if (st.algorithm && !['myers', 'patience'].includes(st.algorithm)) err(W, 'diffView.algorithm must be myers|patience');
        if (st.granularity && !['line', 'word'].includes(st.granularity)) err(W, 'diffView.granularity must be line|word');
        break;
      }
      case 'layout':
        if (!['single', 'columns'].includes(st.mode)) err(W, 'layout.mode must be single|columns');
        if (st.mode === 'single') active = 0;
        break;
      case 'say': if (!st.text) err(W, 'say needs "text"'); break;
      case 'wait': if (typeof st.ms !== 'number') err(W, 'wait needs "ms"'); break;
      default: paneOf(st);
    }
  }

  /**
   * The tour: every changed hunk of every changed file is replayed, in narrative
   * order, and the author's explanation scenes are woven in where they attach
   * (`at: {file, hunk?}`). Nothing changed can be skipped. `tour: false` turns it off.
   */
  function expandTour() {
    if (ir.tour === false) return;
    const tour = ir.tour && typeof ir.tour === 'object' ? ir.tour : {};
    const ko = String((ir.meta && ir.meta.language) || '').startsWith('ko');
    const changed = Object.entries(ir.files)
      .filter(([p, f]) => f.status !== 'context' && !L.isGeneratedFile(p) && (f.before != null || f.after != null) && !(f.before != null && f.after != null && f.before === f.after && !f.oldPath))
      .map(([p]) => p);
    const order = [];
    const push = (p) => { if (changed.includes(p) && !order.includes(p)) order.push(p); };
    for (const p of tour.order || []) { if (!ir.files[p]) warn('tour.order', `unknown file "${p}"`); push(p); }
    for (const ch of ir.chapters || []) for (const sc of ch.scenes || []) { if (sc.at && sc.at.file) push(sc.at.file); for (const st of sc.steps || []) stepFiles(st).forEach(push); }
    changed.filter((p) => !L.isTestFile(p)).sort().forEach(push);
    changed.sort().forEach(push);
    // hunks (change blocks) per file, with a tempo
    const lineOf = (p, side, n) => ((linesOf(p, side) || [])[n - 1] || '');
    const wiring = /^\s*(import\b|export\s+(\*|\{[^}]*\})\s+from\b|from\s+\S+\s+import\b|require\(|#include\b|use\s|mod\s+\w+;|[A-Za-z_$][\w$]*,?\s*$|\]\s*,?\s*$|\}\s*from\b)/;
    const isBarrel = (p) => { const t = ir.files[p].after; return /(^|\/)(index|__init__|mod)\.[a-z]+$/.test(p) && t != null && t.split('\n').every((l) => !l.trim() || wiring.test(l) || /^\s*export\s+\*/.test(l)); };
    const attached = new Map(); // "file#hunk" → true
    for (const ch of ir.chapters || []) for (const sc of ch.scenes || []) if (sc.at && sc.at.file && sc.at.hunk) attached.set(`${sc.at.file}#${sc.at.hunk}`, true);
    const items = [];
    for (const p of order) {
      const f = ir.files[p];
      const blocks = changeBlocks(p);
      if (!blocks.length) continue; // pure rename: shown by the explorer
      blocks.forEach((b, i) => {
        const key = `${p}#${i + 1}`;
        const lines = [];
        if (b.newFrom != null) for (let n = b.newFrom; n <= b.newTo; n++) lines.push(lineOf(p, 'after', n));
        if (b.oldFrom != null) for (let n = b.oldFrom; n <= b.oldTo; n++) lines.push(lineOf(p, 'before', n));
        const auto = isBarrel(p) || (lines.length <= 6 && lines.every((l) => !l.trim() || wiring.test(l))) ? 'skim' : attached.has(key) ? 'key' : 'normal';
        const tempo = (tour.tempo && (tour.tempo[key] || tour.tempo[p])) || auto;
        items.push({ file: p, hunk: i + 1, of: blocks.length, tempo });
      });
    }
    const viewFor = (p) => { const f = ir.files[p]; return f.status === 'added' || f.before == null ? 'after' : 'diff'; };
    let next = 0, tk = 0;
    const segOf = (p) => items.filter((x) => x.file === p);
    const take = (upto) => {
      const out = [];
      while (next <= upto && next < items.length) {
        const p = items[next].file;
        const hunks = [];
        while (next <= upto && next < items.length && items[next].file === p) hunks.push(items[next++]);
        const parts = p.split('/');
        const generic = /^(index|__init__|mod|main|types|utils?|constants?)\.[a-z]+$/i.test(parts[parts.length - 1]);
        const name = generic && parts.length > 1 ? parts.slice(-2).join('/') : parts[parts.length - 1];
        const all = segOf(p);
        const cont = hunks[0].hunk > 1;
        const q = (tour.questions && tour.questions[p]) || (ko ? `${name}에서 무엇이 바뀌었나?` : `What changed in ${name}?`);
        out.push({
          id: `tour-${++tk}`, auto: true, title: name + (cont ? (ko ? ' (이어서)' : ' (cont.)') : ''), question: q, narration: '',
          tour: { file: p, hunks: hunks.map((h) => h.hunk), of: all.length },
          steps: [{ do: 'open', file: p, view: viewFor(p), noReveal: true, fast: hunks.every((h) => h.tempo === 'skim') }, ...hunks.map((h) => ({ do: 'replay', file: p, hunk: h.hunk, tempo: h.tempo }))],
        });
      }
      return out;
    };
    const chapters = [];
    for (const ch of ir.chapters || []) {
      const scs = [];
      for (const sc of ch.scenes || []) {
        if (sc.at && sc.at.file) {
          if (!ir.files[sc.at.file]) warn(`scene ${sc.id || sc.title}`, `at.file "${sc.at.file}" is not in files`);
          let idx = -1;
          items.forEach((it, i) => { if (it.file === sc.at.file && (sc.at.hunk == null || it.hunk <= sc.at.hunk)) idx = i; });
          if (idx < 0 && changed.includes(sc.at.file) && sc.at.hunk) warn(`scene ${sc.id || sc.title}`, `at.hunk ${sc.at.hunk} does not exist in ${sc.at.file}`);
          if (idx >= next) scs.push(...take(idx));
        }
        scs.push(sc);
      }
      chapters.push({ ...ch, scenes: scs });
    }
    if (next < items.length) chapters.push({ id: 'tour-rest', title: ko ? '나머지 변경' : 'Remaining changes', goal: ko ? '아직 보지 않은 변경을 모두 훑는다' : 'Go through every change not yet shown', scenes: take(items.length - 1) });
    ir.chapters = chapters;
    ir.tourStats = { hunks: items.length, files: new Set(items.map((x) => x.file)).size };
  }

  function stepFiles(st) {
    const out = [st.file];
    if (st.do === 'goto') out.push(st.to && st.to.file);
    if (st.do === 'refs') for (const it of st.items || []) out.push(it.file);
    return out.filter(Boolean);
  }
  function walkSteps(fn) { for (const ch of ir.chapters || []) for (const sc of ch.scenes || []) for (const st of sc.steps || []) fn(st); }


  const nScenes = (ir.chapters || []).reduce((a, c) => a + (c.scenes || []).length, 0);
  // Where every anchor landed: lets an author verify placement, not just existence.
  const resolved = [];
  const text = (file, side, line) => ((linesOf(file, side) || [])[line - 1] || '').trim().slice(0, 120);
  const touched = new Set();
  (ir.chapters || []).forEach((ch, ci) => (ch.scenes || []).forEach((sc, si) => (sc.steps || []).forEach((st, ti) => {
    const W = `chapters[${ci}].scenes[${si}](${sc.id}).steps[${ti}]`;
    for (const f of stepFiles(st)) touched.add(f);
    if (st._file) touched.add(st._file);
    if (st._r && (st._file || st.file)) {
      const file = st._file || st.file;
      resolved.push({ path: W, do: st.do, file, side: st._r.side, from: st._r.from ?? st._r.line, to: st._r.to ?? st._r.line, text: text(file, st._r.side, st._r.from ?? st._r.line) });
    }
    if (st._from && st._from.line) resolved.push({ path: W + '.from', do: 'goto', file: st._from.file, side: st._from.side, from: st._from.line, to: st._from.line, text: text(st._from.file, st._from.side, st._from.line) });
    if (st._to && st._to.line) resolved.push({ path: W + '.to', do: 'goto', file: st._to.file, side: st._to.side, from: st._to.from, to: st._to.to, view: st._to.view, text: text(st._to.file, st._to.side, st._to.from) });
    (st._items || []).forEach((it, k) => resolved.push({ path: `${W}.items[${k}]`, do: 'refs', file: it.file, side: it.side, from: it.line, to: it.line, text: it.text }));
  })));
  for (const n of (ir.chapters || []).flatMap((c) => c.scenes || []).flatMap((s) => s.steps || []).filter((x) => x.do === 'graph').flatMap((x) => x.nodes || [])) if (n.file) touched.add(n.file);
  const unnarratedFiles = Object.entries(ir.files || {}).filter(([p, f]) => f.status !== 'context' && !touched.has(p)).map(([p]) => p);
  const stats = { chapters: (ir.chapters || []).length, scenes: nScenes, files: Object.keys(ir.files || {}).length, tour: ir.tourStats || null,
    estimatedSeconds: Math.round(WalkTiming.total(ir) / 1000), unnarratedFiles };
  if (!errors.length && range && opts.tree !== false) ir.tree = buildTree(repo, range, ir.files);
  if (!errors.length) {
    ir.source = { ...(ir.source || {}), ...(range ? { base: range.base, head: range.head, baseSha: range.baseSha.slice(0, 10), headSha: range.headSha === G.WORKTREE ? G.WORKTREE : range.headSha.slice(0, 10) } : {}) };
    delete ir.source.repo; // never leak absolute local paths into a shareable page
    for (const f of Object.values(ir.files)) delete f.unnarrated;
    ir.compiled = { engineIrVersion: IR_VERSION, at: new Date().toISOString() };
  }
  return { ok: errors.length === 0, ir, errors, warnings, stats, resolved };
}

/** Compiled IR -> standalone HTML string. */
export function render(ir, { inject = '' } = {}) {
  const tpl = fs.readFileSync(path.join(PLAYER_DIR, 'template.html'), 'utf8');
  const inline = (name) => fs.readFileSync(path.join(PLAYER_DIR, name), 'utf8');
  const json = JSON.stringify(ir).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return tpl
    .replace('{{TITLE}}', () => escapeHtml((ir.meta && ir.meta.title) || 'Code walkthrough'))
    .replace('/*{{CSS}}*/', () => inline('player.css'))
    .replace('/*{{DIFF}}*/', () => inline('diff.js'))
    .replace('/*{{HIGHLIGHT}}*/', () => inline('highlight.js'))
    .replace('/*{{TIMING}}*/', () => inline('timing.js'))
    .replace('/*{{PLAYER}}*/', () => inline('player.js'))
    .replace('{{IR}}', () => json)
    .replace('</body>', () => `${inject}</body>`);
}

/** Read + compile an IR file (relative source.repo resolves against the file's directory). */
export function compileFile(file, opts = {}) {
  const input = JSON.parse(fs.readFileSync(file, 'utf8'));
  return compile(input, { baseDir: path.dirname(path.resolve(file)), ...opts });
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * The repository's file tree at head, for the player's explorer (compact form:
 * a directory table plus [dirIndex, name] pairs). Very large repositories are
 * pruned to the directories that lead to files used by the walkthrough; pruned
 * directories are listed in `partial` so the explorer can say so.
 */
const TREE_LIMIT = 25000;
function buildTree(repo, range, files) {
  let paths = G.listFiles(repo, range.head);
  const set = new Set(paths);
  for (const p of Object.keys(files)) if (!set.has(p)) { set.add(p); paths.push(p); }
  const partial = new Set();
  if (paths.length > TREE_LIMIT) {
    const keepDirs = new Set(['']);
    for (const p of Object.keys(files)) { const parts = p.split('/'); for (let i = 1; i < parts.length; i++) keepDirs.add(parts.slice(0, i).join('/')); }
    paths = paths.filter((p) => {
      const d = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
      if (keepDirs.has(d)) return true;
      // keep the first-level directory below a kept directory as a (partial) placeholder
      const parts = d.split('/');
      for (let i = parts.length - 1; i >= 1; i--) { const parent = parts.slice(0, i).join('/'); if (keepDirs.has(parent)) { partial.add(parts.slice(0, i + 1).join('/')); break; } }
      if (parts.length >= 1 && keepDirs.has('') && !keepDirs.has(parts[0])) partial.add(parts[0]);
      return false;
    });
  }
  paths.sort();
  const dirs = [];
  const dirIndex = new Map();
  const out = [];
  for (const p of paths) {
    const i = p.lastIndexOf('/');
    const d = i < 0 ? '' : p.slice(0, i);
    if (!dirIndex.has(d)) { dirIndex.set(d, dirs.length); dirs.push(d); }
    out.push([dirIndex.get(d), p.slice(i + 1)]);
  }
  // name the root after the repository (origin remote), not the local checkout/worktree folder
  const origin = (G.git(repo, ['remote', 'get-url', 'origin'], { allowFail: true }) || '').trim();
  const root = (origin && origin.replace(/\.git$/, '').split(/[/:]/).pop()) || path.basename(repo);
  return { root, dirs, files: out, partial: [...partial].sort(), total: set.size };
}
