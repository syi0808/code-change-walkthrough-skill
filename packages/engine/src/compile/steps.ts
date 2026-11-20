// Step resolution: validates every step, tracks what each pane shows while the
// walkthrough runs, and records what the player needs (resolved ranges, how a file
// is reached, what a replay animates).
import { EDITOR_HALF_ROWS, EDITOR_ROW, narrationItems } from '../shared/timing.ts';
import { inFolder, walkPlan, walkTotal } from '../shared/tree-path.ts';
import type { Action, RefItem, Scene, Step, View } from '../ir/types.ts';
import { resolvePoint, resolveRange } from './anchors.ts';
import type { CompileContext } from './context.ts';

const KNOWN = new Set<Action>(['open', 'layout', 'diffView', 'reveal', 'highlight', 'focus', 'unfocus', 'note', 'type', 'replay', 'goto', 'refs', 'impact', 'graph', 'say', 'wait', 'clear', 'close', 'delete', 'back']);
/** A drill-down longer than this many steps loses the line it left (the goal decays while away). */
const DETOUR_MAX_STEPS = 6;
const EFFECTS = new Set(['safe', 'check', 'breaks', 'updated']);
const VIEWS = new Set<View>(['after', 'before', 'diff']);
/** Above this many characters a key hunk is replayed line by line: typing keeps one constant cadence. */
const TYPE_MAX_CHARS = 400;

interface PaneTrack { file: string | null; view: View; tabs: Set<string> }

export function resolveScenes(cx: CompileContext): void {
  const ir = cx.ir;
  const panes: PaneTrack[] = [{ file: null, view: 'after', tabs: new Set() }, { file: null, view: 'after', tabs: new Set() }];
  // what each pane really shows at runtime (tour included): tour scenes restore `panes`, never this
  const onScreen: (string | null)[] = [null, null];
  // files the explorer has shown: the first open of an added or renamed one is a file operation (FsOp)
  const born = new Set<string>();
  const setPane = (p: number, file: string, view: View) => { panes[p].tabs.add(file); panes[p].file = file; panes[p].view = view; onScreen[p] = file; born.add(file); };
  // folders that exist before the change: those of every file that is not new (and of renamed files' old paths)
  const before = new Set<string>(['']);
  {
    const fresh = new Set(Object.entries(ir.files).filter(([, f]) => f.status === 'added' || (f.status === 'renamed' && f.oldPath)).map(([p]) => p));
    const add = (p: string) => { const parts = p.split('/'); for (let i = 1; i < parts.length; i++) before.add(parts.slice(0, i).join('/')); };
    for (const p of [...(ir.tree ? ir.tree.files.map(([d, n]) => (ir.tree!.dirs[d] ? `${ir.tree!.dirs[d]}/${n}` : n)) : []), ...Object.keys(ir.files)]) if (!fresh.has(p)) add(p);
    for (const f of Object.values(ir.files)) if (f.oldPath) add(f.oldPath);
  }
  const dirOf = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/')));
  const existing = (p: string) => { let d = dirOf(p); while (d && !before.has(d)) d = dirOf(d); return d; };
  const relative = (fromDir: string, to: string) => {
    const a = fromDir ? fromDir.split('/') : [], b = to.split('/');
    let k = 0; while (k < a.length && k < b.length - 1 && a[k] === b[k]) k++;
    return [...a.slice(k).map(() => '..'), ...b.slice(k)].join('/');
  };
  let active = 0;
  // where each pane's editor was last brought to (file and line): how far the next scroll goes
  const at: ({ file: string; line: number } | null)[] = [null, null];
  /** Rows from the pane's last place to `line` (0 for another file: it opens already there). An
   *  "ensure" moves only once the line is out of view, so the first half screen costs nothing. */
  const moveTo = (p: number, file: string, line: number, ensure: boolean): number => {
    const was = at[p];
    at[p] = { file, line };
    if (!was || was.file !== file) return 0;
    return Math.max(0, Math.abs(line - was.line) - (ensure ? EDITOR_HALF_ROWS : 0)) * EDITOR_ROW;
  };
  // where each goto was clicked, for a later `back` (Go Back): the drill-down's way home
  const trail: { st: Step; pane: number; file: string; view: View; side: 'before' | 'after'; line: number; scene: string; n: number }[] = [];
  let stepNo = 0;
  const detours: { a: number; b: number; W: string }[] = [];
  const sceneOf = (W: string) => W.replace(/\.steps\[\d+\].*$/, '');
  const walkMs = (from: string, to: string) => Math.round(walkPlan(cx.dirs, from, to).reduce((a, x) => a + x.ms, 0));
  const sceneIds = new Set<string>();
  let authored = 0;

  const paneOf = (st: Step) => { if (st.pane !== undefined) active = st.pane ? 1 : 0; return active; };
  const useFile = (st: Step, W: string) => {
    const p = paneOf(st);
    if (st.file) {
      if (!ir.files[st.file]) cx.err(W, `unknown file "${st.file}"`);
      if (panes[p].file !== st.file || onScreen[p] !== st.file) {
        // the file in view changes with this step: the explorer walks there during it
        if (onScreen[p] && onScreen[p] !== st.file && ir.files[st.file]) st._walk = walkMs(onScreen[p], st.file);
        setPane(p, st.file, st.view || panes[p].view || 'after');
      }
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
    stepNo++;
    if (!KNOWN.has(st.do)) { cx.err(W, `unknown action "${st.do}" (known: ${[...KNOWN].join(', ')})`); return; }
    if (st.view && !VIEWS.has(st.view)) cx.err(W, 'view must be one of after|before|diff');
    switch (st.do) {
      case 'open': {
        const shown = onScreen[active];
        const p = paneOf(st);
        if (!st.file || !ir.files[st.file]) { cx.err(W, `unknown file "${st.file}"`); return; }
        const f = ir.files[st.file];
        const view = st.view || viewOf(st.file);
        st.view = view;
        // how the player gets there: through the explorer, by clicking an open tab, or not at all.
        // Judged by what is on screen, not by what the author's scenes assume is open.
        st._openKind = onScreen[p] === st.file ? 'same' : panes[p].tabs.has(st.file) ? 'tab' : 'tree';
        if (st._openKind === 'tree' || (st._openKind === 'tab' && onScreen[p])) st._walk = walkMs(st._openKind === 'tree' ? shown! : onScreen[p]!, st.file);
        // the first time an added or renamed file is opened from the tree, it is created, renamed or moved first
        if (st._openKind === 'tree' && !born.has(st.file)) {
          if (f.status === 'added') {
            const parent = existing(st.file);
            const rel = st.file.slice(parent ? parent.length + 1 : 0);
            const cut = rel.lastIndexOf('/');
            // folders that do not exist yet are made first (New Folder), then the file in them (New File)
            st._fs = cut < 0 ? { kind: 'create', parent, name: rel } : { kind: 'create', parent, dir: rel.slice(0, cut), name: rel.slice(cut + 1) };
            st._walk = walkTotal(cx.dirs, shown, inFolder(parent));
            st._fs.settle = walkTotal(cx.dirs, inFolder(dirOf(st.file)), st.file);
            if (st._fs.dir) st._fs.reveal = walkTotal(cx.dirs, inFolder(parent), inFolder(dirOf(st.file)));
            // the folders it made exist from now on: a later file in them is created there, not made again
            for (let d = dirOf(st.file); d && !before.has(d); d = dirOf(d)) before.add(d);
          } else if (f.status === 'renamed' && f.oldPath && f.oldPath !== st.file) {
            const from = f.oldPath, newDir = dirOf(st.file);
            st._walk = walkTotal(cx.dirs, shown, from);
            if (dirOf(from) === newDir) st._fs = { kind: 'rename', parent: newDir, name: st.file.slice(newDir ? newDir.length + 1 : 0), from };
            else if (before.has(newDir)) st._fs = { kind: 'move', parent: newDir, name: st.file.slice(newDir ? newDir.length + 1 : 0), from, drag: walkTotal(cx.dirs, from, inFolder(newDir), true) };
            // into a folder that does not exist yet: F2 with the new path, as VS Code allows
            else st._fs = { kind: 'rename', parent: dirOf(from), name: relative(dirOf(from), st.file), from };
            for (let d = newDir; d && !before.has(d); d = dirOf(d)) before.add(d);
            if (st._fs) st._fs.settle = st._fs.kind === 'move' ? walkTotal(cx.dirs, inFolder(newDir), st.file, true) : walkTotal(cx.dirs, from, st.file);
          }
        }
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
        { const land = st._r || st._first; const px = land ? moveTo(p, st.file, land.from, false) : (at[p] = null, 0); if (st._openKind === 'same' && px) st._move = px; }
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
        if (st._r && st.reveal !== false) { const px = moveTo(u.p, u.file, st._r.from, st.do === 'highlight' || st.do === 'note' || st.do === 'type' || st.do === 'replay'); if (px) st._move = px; }
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
        const probe: Step = { do: 'goto', file: from.file, view: from.view, pane: st.pane };
        const u = useFile(probe, W); if (!u) return;
        st._pane = u.p;
        st._from = { file: u.file, ...(resolvePoint(cx, from.at, u.file, u.view, W + '.from') || {}) };
        if (st._from.line) { const px = moveTo(u.p, u.file, st._from.line, true); if (px) st._moveFrom = px; }
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
        if (r) { const px = moveTo(tp, to.file, r.from, false); if (px) st._move = px; }
        if (st._from.line && st._from.side) {
          trail.push({ st, pane: u.p, file: u.file, view: u.view, side: st._from.side, line: st._from.line, scene: sceneOf(W), n: stepNo });
        }
        setPane(tp, to.file, tview);
        active = tp;
        return;
      }
      case 'back': {
        // Go Back: to the line the last goto was clicked on, in its pane
        const home = trail.pop();
        if (!home) { cx.err(W, '"back" needs a "goto" before it to return from'); return; }
        home.st._detour = true;
        detours.push({ a: home.n, b: stepNo, W });
        if (home.scene !== sceneOf(W)) cx.warn(W, '"back" returns to a goto in another scene: keep a drill-down inside one scene');
        else if (stepNo - home.n > DETOUR_MAX_STEPS) cx.warn(W, `the drill-down lasts ${stepNo - home.n - 1} steps: keep it to what the line needs (1 or 2 points), so the line it left is still in mind when it returns`);
        st._pane = home.pane;
        st._to = { file: home.file, pane: home.pane, view: home.view, side: home.side, line: home.line, from: home.line, to: home.line };
        { const px = moveTo(home.pane, home.file, home.line, false); if (px) st._move = px; }
        setPane(home.pane, home.file, home.view);
        active = home.pane;
        return;
      }
      case 'refs': case 'impact': {
        if (!Array.isArray(st.items) || !st.items.length) { cx.err(W, `${st.do} needs "items": [{file, at, label?${st.do === 'impact' ? ', effect?, relation?' : ''}}]`); return; }
        const p = paneOf(st);
        st._pane = p;
        st._items = st.items.flatMap((it, i) => {
          if (!ir.files[it.file]) { cx.err(`${W}.items[${i}]`, `unknown file "${it.file}"`); return []; }
          const view = it.view || viewOf(it.file);
          const r = resolvePoint(cx, it.at, it.file, view, `${W}.items[${i}]`);
          if (!r) return [];
          const item: RefItem = { file: it.file, view, side: r.side, line: r.line, label: it.label || null, text: cx.lineText(it.file, r.side, r.line).trim().slice(0, 160) };
          if (st.do === 'impact') {
            if (it.effect !== undefined && !EFFECTS.has(it.effect)) cx.err(`${W}.items[${i}]`, `effect must be one of ${[...EFFECTS].join('|')}`);
            Object.assign(item, { effect: it.effect, relation: it.relation, outside: ir.files[it.file].status === 'context' });
          }
          return [item];
        });
        // an impact step is for what the diff does not show: places the change reaches but did not edit
        if (st.do === 'impact' && st._items.length && !st._items.some((x) => x.outside)) cx.warn(W, 'every impact item is a changed file: show the places outside the diff that depend on the change (callers, consumers, config), or use refs');
        for (const it of st._items) { panes[p].tabs.add(it.file); born.add(it.file); }
        // per item: the explorer's walk to its file, or the editor's scroll within the same file
        {
          let prev = onScreen[p];
          st._itemWalk = []; st._itemMove = [];
          for (const it of st._items) {
            st._itemWalk.push(prev && prev !== it.file ? walkMs(prev, it.file) : 0);
            st._itemMove.push(moveTo(p, it.file, it.line, false));
            prev = it.file;
          }
        }
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
      case 'delete': {
        const p = paneOf(st);
        if (!st.file || !ir.files[st.file]) { cx.err(W, `unknown file "${st.file}"`); return; }
        st._pane = p;
        panes[p].tabs.delete(st.file);
        if (onScreen[p] === st.file) { const last = [...panes[p].tabs].pop() || null; onScreen[p] = last; panes[p].file = last; }
        return;
      }
      case 'layout':
        if (!['single', 'columns'].includes(st.mode || '')) cx.err(W, 'layout.mode must be single|columns');
        if (st.mode === 'single') {
          // back to one pane: the explorer walks from the file that was active to the left pane's
          if (active !== 0 && onScreen[active] && onScreen[0] && onScreen[active] !== onScreen[0]) st._walk = walkMs(onScreen[active]!, onScreen[0]!);
          active = 0;
        }
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
        const explicit = ['open', 'goto', 'layout', 'graph', 'refs', 'impact'].includes(first.do) || !!first.file;
        const want = panes[p0].file;
        if (!explicit && want && onScreen[p0] && want !== onScreen[p0]) steps.unshift({ do: 'open', file: want, view: panes[p0].view, pane: p0, noReveal: true });
      }
      steps.forEach((st, ti) => resolveStep(st, `${W}.steps[${ti}]`));
      if (snap) { panes.forEach((x, i) => { x.file = snap.panes[i].file; x.view = snap.panes[i].view; }); active = snap.active; }
      const items = narrationItems(sc.narration);
      steps.forEach((st, ti) => {
        if (st.cue === undefined) return;
        if (!Number.isInteger(st.cue) || st.cue < 1 || st.cue > items.length) cx.err(`${W}.steps[${ti}]`, `cue ${JSON.stringify(st.cue)} must be 1..${items.length} (the narration has ${items.length} sentence/bullet item${items.length === 1 ? '' : 's'})`);
      });
    });
  });
  if (!ir.chapters.length) cx.err('chapters', 'no chapters');
  // a drill-down inside a drill-down: two lines to come back to, and the first is lost
  for (const d of detours) if (detours.some((o) => o.a < d.a && d.b < o.b)) cx.warn(d.W, 'a drill-down inside a drill-down: come "back" before going to another definition; one detour at a time keeps the line it left in mind');
}
