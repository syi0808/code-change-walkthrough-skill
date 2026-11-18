<script lang="ts">
  // VS Code-like explorer. Folders start closed. Picking a file walks the tree the way a person
  // does with the mouse: the pointer clicks the old file's folders closed up to the folder both
  // files share, then clicks the new file's folders open one at a time, and the selection follows
  // each click (shared/tree-path foldMoves, timed by walkAt).
  // Everything here is a function of the frame: which rows exist and how tall they are (a folder's
  // rows grow in on the timeline, not on a wall-clock transition), where the selection is, and the
  // scroll (state.exTop, core/explorer.ts). Nothing is read back from the screen to decide what to show.
  import { onDestroy } from 'svelte';
  import { ORDER, player } from '../app/player.svelte.ts';
  import { clamp, ease, fileIcon, ICON, IR, STATUS_LETTER, t } from '../core/env.ts';
  import { ROW_H, setExplorerView } from '../core/explorer.ts';
  import { resetSnapshots } from '../core/state.ts';
  import { fileGone } from '../core/timeline.ts';
  import { rowsAt, dirs, type TreeRow } from '../core/tree.ts';
  import { FOLD_CLICK, FOLD_TRAVEL, walkAt } from '../../shared/timing.ts';
  import { chain, foldMoves } from '../../shared/tree-path.ts';

  const s = $derived(player.frame);
  const activeFile = $derived(s.panes[s.active].file);
  const target = $derived(s.exFocus || activeFile);
  const open = $derived(new Set(s.panes.flatMap((p) => p.tabs)));
  const isGone = (p: string) => player.started && fileGone[p] != null && fileGone[p] <= player.T;

  /** The walk in progress: which move (k; k === folds is the file's row) and how far into it (local, 0..1). */
  const motion = $derived.by(() => {
    const ex = s.exScroll;
    if (!ex) return null;
    const moves = foldMoves(dirs, ex.from, ex.file);
    const folds = moves.length - 1;
    const { k, local } = walkAt(folds, ex.p);
    return { moves, folds, k, local, from: ex.from, file: ex.file, pick: ex.pick, cursor: ex.cursor };
  });
  /** A folder move: the selection goes to the row on the click, the folder toggles when the click ends. */
  const clickP = (local: number) => ease(clamp((local - FOLD_TRAVEL) / (FOLD_CLICK - FOLD_TRAVEL), 0, 1));
  const toggleP = (local: number) => ease(clamp((local - FOLD_CLICK) / (1 - FOLD_CLICK), 0, 1));

  interface Row extends TreeRow { g: number }
  /** Rows on the timeline: the folders open before the current move, plus the one it toggles, growing or shrinking. */
  const model = $derived.by((): { rows: Row[]; y: Map<string, number> } => {
    const T = player.T, focus = s.exFocus;
    let before: Set<string>, after: Set<string>, q = 1;
    if (player.manualTree) before = after = new Set(player.expanded);
    else if (!player.started) before = after = new Set();
    else if (!motion) before = after = new Set(chain(dirs, target));
    else {
      before = new Set(chain(dirs, motion.from));
      for (let j = 0; j < motion.k; j++) { const mv = motion.moves[j]; if (mv.kind === 'close') before.delete(mv.path); else if (mv.kind === 'open') before.add(mv.path); }
      after = new Set(before);
      const mv = motion.moves[motion.k];
      if (motion.k < motion.folds && motion.local >= FOLD_CLICK) { if (mv.kind === 'close') after.delete(mv.path); else after.add(mv.path); q = toggleP(motion.local); }
    }
    const union = new Set([...before, ...after]);
    const filter = player.ui.exFilter;
    const inB = new Set(rowsAt(before, filter, T, focus, player.started).map((r) => r.path));
    const inA = before === after ? inB : new Set(rowsAt(after, filter, T, focus, player.started).map((r) => r.path));
    const rows: Row[] = [];
    const y = new Map<string, number>();
    let acc = 0;
    for (const r of rowsAt(union, filter, T, focus, player.started)) {
      const g = inA.has(r.path) && inB.has(r.path) ? 1 : inA.has(r.path) ? q : 1 - q;
      if (g <= 0) continue;
      rows.push({ ...r, open: r.kind === 'dir' ? after.has(r.path) : r.open, g });
      y.set(r.path, acc);
      acc += ROW_H * g;
    }
    return { rows, y };
  });
  const onPath = (p: string) => !!target && (target === p || target.startsWith(p + '/'));
  /** The row the walk is on now: lit while everything else recedes. */
  const cur = $derived(motion && motion.k < motion.folds ? motion.moves[motion.k].path : null);
  /** The selection: one bar that moves with the clicks (an object that moves is seen as one thing going somewhere). */
  const sel = $derived.by((): { y: number; o: number } | null => {
    if (!player.started) return null;
    const Y = (p: string | null | undefined) => (p ? model.y.get(p) ?? null : null);
    const m = motion;
    if (!m) { const y = Y(target); return y == null ? null : { y, o: 1 }; }
    let a: number | null, b: number | null, q: number;
    if (!m.cursor) { a = Y(m.from); b = Y(m.file); q = ease(m.pick); }
    else if (m.k < m.folds) { a = Y(m.k > 0 ? m.moves[m.k - 1].path : m.from); b = Y(m.moves[m.k].path); q = clickP(m.local); }
    else { a = Y(m.folds > 0 ? m.moves[m.folds - 1].path : m.from); b = Y(m.file); q = m.pick; }
    if (b == null) return a == null ? null : { y: a, o: 1 };
    return a == null ? { y: b, o: q } : { y: a + (b - a) * q, o: 1 };
  });

  let body: HTMLDivElement | undefined = $state();

  function own() {
    if (player.manualTree) return;
    player.expanded.clear();
    for (const d of chain(dirs, target)) player.expanded.add(d);
    player.manualTree = true;
  }
  function toggleDir(path: string) {
    own();
    if (player.expanded.has(path)) player.expanded.delete(path); else player.expanded.add(path);
    player.commit();
  }
  function collapseAll() { own(); player.expanded.clear(); player.commit(); }

  // ---- layout: the explorer's size goes into the state (its scroll is computed there); then the scroll is applied
  let applied: { el: HTMLElement; top: number } | null = null;
  const off = player.layout(ORDER.explorer, () => {
    if (!body) return;
    if (setExplorerView(body.clientHeight, player.ui.exFilter)) { resetSnapshots(); player.stateVersion++; queueMicrotask(() => player.commit()); return; }
    if (player.manualTree || !player.started) return;
    // paused with nothing changed: leave the list where the viewer may have scrolled it
    if (!player.playing && applied && applied.el === body && applied.top === s.exTop) return;
    applied = { el: body, top: s.exTop };
    body.scrollTop = s.exTop;
  });
  onDestroy(off);
</script>

<aside class="wt-explorer" aria-label={t('explorer.title')}>
  <div class="ex-head"><span>{t('explorer.title')}</span><span class="ex-actions">
    <button class="icon-btn sm" class:on={player.ui.exFilter} title={t('explorer.changedOnly')} onclick={() => { player.ui.exFilter = !player.ui.exFilter; player.commit(); }}>{@html ICON.filter}</button>
    <button class="icon-btn sm" title={t('explorer.collapseAll')} onclick={collapseAll}>{@html ICON.collapse}</button></span></div>
  <div class="ex-root"><span class="tw open">{@html ICON.chevron}</span>{(IR.tree?.root || t('explorer.repository')).toUpperCase()}</div>
  <div class="ex-body" class:spot={!!target && player.started} role="tree" bind:this={body}>
    {#if sel}<div class="ex-sel" style="transform:translateY({sel.y.toFixed(1)}px){sel.o < 1 ? `;opacity:${sel.o.toFixed(3)}` : ''}"></div>{/if}
    {#each model.rows as r (r.path)}
      {@const pad = `padding-left:${8 + r.depth * 12}px`}
      <div class="ex-row-wrap" style={r.g < 1 ? `height:${(ROW_H * r.g).toFixed(2)}px;opacity:${r.g.toFixed(3)}` : null}>
        {#if r.kind === 'more'}
          <div class="ex-row more" style={pad}>{#each { length: r.depth } as _, k}<span class="ig" style="left:{14 + k * 12}px"></span>{/each}<span class="tw"></span><span class="nm">{t('explorer.omitted')}</span></div>
        {:else if r.kind === 'dir'}
          <div class="ex-row dir" class:has-changes={!!r.changed} class:path={onPath(r.path)} class:cur={r.path === cur} data-path={r.path} role="treeitem" aria-selected="false" aria-expanded={r.open} tabindex="-1" title={r.path} style={pad}
            onclick={() => toggleDir(r.path)} onkeydown={(e) => e.key === 'Enter' && toggleDir(r.path)}>
            {#each { length: r.depth } as _, k}<span class="ig" style="left:{14 + k * 12}px"></span>{/each}<span class="tw" class:open={r.open}>{@html ICON.chevron}</span><span class="nm">{r.label}</span>{#if r.changed}<span class="dot"></span>{/if}
          </div>
        {:else}
          {@const icon = fileIcon(r.label)}
          <div class="ex-row file{r.status ? ` st-${r.status}` : ''}" class:gone={isGone(r.path)} class:open={open.has(r.path)} class:active={r.path === activeFile} class:selecting={r.path === s.exFocus} class:target={r.path === target} class:cur={r.path === cur} class:stub={!r.embedded}
            role="treeitem" aria-selected={r.path === activeFile} tabindex="-1" data-file={r.path} data-path={r.path} style={pad} title={r.path + (r.embedded ? '' : ': ' + t('explorer.notEmbedded'))}
            onclick={() => player.exploreOpen(r.path)} onkeydown={(e) => e.key === 'Enter' && player.exploreOpen(r.path)}>
            {#each { length: r.depth } as _, k}<span class="ig" style="left:{14 + k * 12}px"></span>{/each}<span class="tw"></span><span class="fi {icon[1]}">{icon[0]}</span><span class="nm">{r.label}</span>{#if r.status}<span class="sb">{STATUS_LETTER[r.status] || ''}</span>{/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
</aside>
