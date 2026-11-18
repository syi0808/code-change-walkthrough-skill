// Step resolution: validates every step, tracks what each pane shows while the
// walkthrough runs, and records what the player needs (resolved ranges, how a file
// is reached, what a replay animates).
import { narrationItems } from '../shared/timing.ts';
import type { Action, Scene, Step, View } from '../ir/types.ts';
import { resolvePoint, resolveRange } from './anchors.ts';
import type { CompileContext } from './context.ts';

const KNOWN = new Set<Action>(['open', 'layout', 'diffView', 'reveal', 'highlight', 'focus', 'unfocus', 'note', 'type', 'replay', 'goto', 'refs', 'graph', 'say', 'wait', 'clear', 'close']);
const VIEWS = new Set<View>(['after', 'before', 'diff']);
/** Above this many characters a key hunk is replayed line by line: typing keeps one constant cadence. */
const TYPE_MAX_CHARS = 400;

interface PaneTrack { file: string | null; view: View; tabs: Set<string> }

export function resolveScenes(cx: CompileContext): void {
  const ir = cx.ir;
  const panes: PaneTrack[] = [{ file: null, view: 'after', tabs: new Set() }, { file: null, view: 'after', tabs: new Set() }];
  const setPane = (p: number, file: string, view: View) => { panes[p].tabs.add(file); panes[p].file = file; panes[p].view = view; };
  let active = 0;
  const realFiles: (string | null)[] = [null, null]; // what each pane really shows at runtime (tour included)
  const sceneIds = new Set<string>();
  let authored = 0;

  const paneOf = (st: Step) => { if (st.pane !== undefined) active = st.pane ? 1 : 0; return active; };
  const useFile = (st: Step, W: string) => {
    const p = paneOf(st);
    if (st.file) {
      if (!ir.files[st.file]) cx.err(W, `unknown file "${st.file}"`);
      if (panes[p].file !== st.file) setPane(p, st.file, st.view || panes[p].view || 'after');
    }
    if (st.view) panes[p].view = st.view;
    if (!panes[p].file) { cx.err(W, 'no file open in this pane: add "file" or an "open" step first'); return null; }
    return { p, file: panes[p].file!, view: panes[p].view };
  };
  const viewOf = (file: string): View => {
    const f = ir.files[file];
    return f.status === 'context' || f.status === 'added' ? 'after' : f.after == null || f.status === 'deleted' ? 'before' : 'diff';
  };

  function resolveStep(st: Step, W: string): void {
    if (!KNOWN.has(st.do)) { cx.err(W, `unknown action "${st.do}" (known: ${[...KNOWN].join(', ')})`); return; }
    if (st.view && !VIEWS.has(st.view)) cx.err(W, 'view must be one of after|before|diff');
    switch (st.do) {
      case 'open': {
        const p = paneOf(st);
        if (!st.file || !ir.files[st.file]) { cx.err(W, `unknown file "${st.file}"`); return; }
        const f = ir.files[st.file];
        const view = st.view || viewOf(st.file);
        st.view = view;
        // how the player gets there: through the explorer, by clicking an open tab, or not at all
        st._openKind = panes[p].file === st.file ? 'same' : panes[p].tabs.has(st.file) ? 'tab' : 'tree';
        // a file with changes plays a top-to-bottom reveal after it opens
        st._reveal = !st.noReveal && st._openKind !== 'same' && view !== 'before' && f.status !== 'context' && !(view === 'after' && f.before == null && f.status !== 'added');
        setPane(p, st.file, view);
        if (view === 'after' && f.after == null) cx.err(W, `${st.file} has no "after" version (deleted): use view "before" or "diff"`);
        if (view === 'before' && f.before == null) cx.err(W, `${st.file} has no "before" version (added)`);
        if (st.at !== undefined) st._r = resolveRange(cx, st.at, st.file, view, W);
        else if (view !== 'before') {
          // open on the first change, not on line 1 (the code above it is unchanged context)
          const b = cx.changeBlocks(st.file)[0];
          if (b) st._first = b.newFrom != null ? { side: 'after', from: b.newFrom, to: b.newTo! } : { side: 'before', from: b.oldFrom!, to: b.oldTo! };
        }
        return;
      }
      case 'reveal': case 'highlight': case 'focus': case 'note': case 'type': case 'replay': {
        if (st.do === 'replay') st.range = { hunk: st.hunk || 1 };
        const u = useFile(st, W); if (!u) return;
        st._file = u.file; st._pane = u.p; st._view = u.view;
        const needsAt = st.do === 'note' || st.do === 'reveal';
        const anchor = needsAt ? st.at : st.range ?? st.at;
        if (anchor === undefined) { cx.err(W, `"${st.do}" needs ${needsAt ? '"at"' : '"range"'}`); return; }
        st._r = resolveRange(cx, anchor, u.file, u.view, W);
        if (st._r && u.view !== 'diff' && st._r.side !== (u.view === 'before' ? 'before' : 'after')) {
          cx.err(W, `anchor is on the ${st._r.side} side but the pane shows "${u.view}": switch to view "diff" or "${st._r.side}"`);
        }
        if (st.do === 'replay' && st._r) {
          const t = cx.typedText(u.file, u.view === 'before' ? 'diff' : u.view, st._r);
          st._chars = t.chars; st._dels = t.dels; st._lines = t.lines;
          const tempo = st.tempo || 'normal';
          if (!['key', 'normal', 'skim'].includes(tempo)) cx.err(W, 'replay.tempo must be key|normal|skim');
          st._mode = tempo === 'skim' ? 'block' : tempo === 'key' && t.chars <= TYPE_MAX_CHARS ? 'type' : 'lines';
        }
        if (st.do === 'type' && st._r) {
          if (u.view === 'before') cx.err(W, '"type" replays an edit: use view "diff" or "after"');
          const t = cx.typedText(u.file, u.view, st._r);
          st._chars = t.chars; st._dels = t.dels;
          if (!t.chars && !t.dels) cx.warn(W, 'type: the range contains no added or removed lines: nothing to animate');
          if (t.lines > 20) cx.warn(W, `type: ${t.lines} lines to type: keep typing for small key edits (≤ ~15 lines); highlight larger blocks instead`);
        }
        if (st.do === 'note' && !st.text) cx.err(W, 'note needs "text"');
        if (st.do === 'note' && st.text && st.text.length > 220) cx.warn(W, 'note longer than 220 chars: keep inline notes short, put detail in narration');
        return;
      }
      case 'goto': {
        const from = st.from || {};
        const u = useFile({ do: 'goto', file: from.file, view: from.view, pane: st.pane }, W); if (!u) return;
        st._pane = u.p;
        st._from = { file: u.file, ...(resolvePoint(cx, from.at, u.file, u.view, W + '.from') || {}) };
        if (!from.token) cx.err(W, 'goto.from needs "token" (the identifier that is Cmd+Clicked)');
        else if (st._from.line && st._from.side) {
          const text = cx.lineText(u.file, st._from.side, st._from.line);
          if (!text.includes(from.token)) cx.err(W, `token "${from.token}" not on ${u.file}:${st._from.line} (${st._from.side}): ${text.trim().slice(0, 80)}`);
        }
        const to = st.to || {};
        if (!to.file || !ir.files[to.file]) { cx.err(W, `goto.to: unknown file "${to.file}"`); return; }
        const tp = to.pane !== undefined ? to.pane : u.p;
        const tf = ir.files[to.file];
        const tview: View = to.view || (tf.after == null ? 'before' : tf.status === 'context' ? 'after' : panes[tp].file === to.file ? panes[tp].view : 'after');
        const r = resolveRange(cx, to.at ?? (from.token ? { symbol: from.token } : 1), to.file, tview, W + '.to');
        st._to = { file: to.file, pane: tp, view: tview, ...(r ? { side: r.side, line: r.from, from: r.from, to: r.to } : {}) };
        setPane(tp, to.file, tview);
        active = tp;
        return;
      }
      case 'refs': {
        if (!Array.isArray(st.items) || !st.items.length) { cx.err(W, 'refs needs "items": [{file, at, label?}]'); return; }
        const p = paneOf(st);
        st._pane = p;
        st._items = st.items.flatMap((it, i) => {
          if (!ir.files[it.file]) { cx.err(`${W}.items[${i}]`, `unknown file "${it.file}"`); return []; }
          const view = it.view || viewOf(it.file);
          const r = resolvePoint(cx, it.at, it.file, view, `${W}.items[${i}]`);
          if (!r) return [];
          return [{ file: it.file, view, side: r.side, line: r.line, label: it.label || null, text: cx.lineText(it.file, r.side, r.line).trim().slice(0, 160) }];
        });
        for (const it of st._items) panes[p].tabs.add(it.file);
        const last = st._items[st._items.length - 1];
        if (last) setPane(p, last.file, last.view);
        return;
      }
      case 'graph': {
        if (st.hide) return;
        const ids = new Set((st.nodes || []).map((n) => n.id));
        if (st.nodes) for (const e of st.edges || []) if (!ids.has(e.from) || !ids.has(e.to)) cx.err(W, `edge ${e.from}→${e.to} references unknown node`);
        for (const n of st.nodes || []) if (n.file && !ir.files[n.file]) cx.warn(W, `graph node "${n.id}" points to unknown file "${n.file}"`);
        return;
      }
      case 'diffView':
        paneOf(st);
        if (st.mode && !['unified', 'split'].includes(st.mode)) cx.err(W, 'diffView.mode must be unified|split');
        if (st.algorithm && !['myers', 'patience'].includes(st.algorithm)) cx.err(W, 'diffView.algorithm must be myers|patience');
        if (st.granularity && !['line', 'word'].includes(st.granularity)) cx.err(W, 'diffView.granularity must be line|word');
        return;
      case 'layout':
        if (!['single', 'columns'].includes(st.mode || '')) cx.err(W, 'layout.mode must be single|columns');
        if (st.mode === 'single') active = 0;
        return;
      case 'say': if (!st.text) cx.err(W, 'say needs "text"'); return;
      case 'wait': if (typeof st.ms !== 'number') cx.err(W, 'wait needs "ms"'); return;
      default: paneOf(st);
    }
  }

  ir.chapters.forEach((ch, ci) => {
    if (!ch.title) cx.warn(`chapters[${ci}]`, 'missing title');
    const authoredHere = (ch.scenes || []).filter((x) => !x.auto).length;
    if (authoredHere > 7) cx.warn(`chapters[${ci}]`, `${authoredHere} scenes: consider splitting the chapter (chunking: ≤ ~5–7 units)`);
    (ch.scenes || []).forEach((sc: Scene, si) => {
      const W = `chapters[${ci}].scenes[${si}]${sc.id ? `(${sc.id})` : ''}`;
      if (!sc.id) sc.id = `c${ci + 1}s${si + 1}`;
      if (sceneIds.has(sc.id)) cx.err(W, `duplicate scene id "${sc.id}"`);
      sceneIds.add(sc.id);
      if (!sc.auto) {
        if (!sc.narration) cx.warn(W, 'no narration');
        if (!sc.question) cx.warn(W, 'no "question": state what the viewer is wondering at this point (shown above the code all scene long)');
        if (authored > 0 && !sc.bridge) cx.warn(W, 'no "bridge": say why this scene follows the previous one (shown on the transition card)');
        authored++;
      }
      if (sc.narration && sc.narration.length > 600) cx.warn(W, `narration is ${sc.narration.length} chars: split the scene (segmenting principle)`);
      if ((sc.steps || []).length > 12) cx.warn(W, `${sc.steps!.length} steps: a scene should carry one idea`);
      // Tour scenes must not change what the author's steps assume is open: resolve them,
      // then restore the author's pane state (tabs stay, since they are real at runtime).
      const snap = sc.auto ? { panes: panes.map((x) => ({ file: x.file, view: x.view })), active } : null;
      // An author scene continuing in a file the tour has since left goes back to it
      // visibly (a tab click) instead of switching files with no cause on screen.
      const steps = sc.steps || [];
      if (!sc.auto && steps.length) {
        const first = steps[0];
        const p0 = first.pane !== undefined ? (first.pane ? 1 : 0) : active;
        const explicit = ['open', 'goto', 'layout', 'graph', 'refs'].includes(first.do) || !!first.file;
        const want = panes[p0].file;
        if (!explicit && want && realFiles[p0] && want !== realFiles[p0]) steps.unshift({ do: 'open', file: want, view: panes[p0].view, pane: p0, noReveal: true });
      }
      steps.forEach((st, ti) => resolveStep(st, `${W}.steps[${ti}]`));
      panes.forEach((x, i) => { realFiles[i] = x.file; });
      if (snap) { panes.forEach((x, i) => { x.file = snap.panes[i].file; x.view = snap.panes[i].view; }); active = snap.active; }
      const items = narrationItems(sc.narration);
      steps.forEach((st, ti) => {
        if (st.cue === undefined) return;
        if (!Number.isInteger(st.cue) || st.cue < 1 || st.cue > items.length) cx.err(`${W}.steps[${ti}]`, `cue ${JSON.stringify(st.cue)} must be 1..${items.length} (the narration has ${items.length} sentence/bullet item${items.length === 1 ? '' : 's'})`);
      });
    });
  });
  if (!ir.chapters.length) cx.err('chapters', 'no chapters');
}
