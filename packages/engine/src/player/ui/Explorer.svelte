<script lang="ts">
  // VS Code-like explorer. Folders start closed. Picking a file walks the tree the way a person
  // does with the keyboard: the old file's folders close up to the folder both files share,
  // the new file's folders open one at a time, and the selection steps onto each row as it
  // goes (shared/tree-path foldMoves). All of it runs on the timeline clock (the "locate" phase).
  import { onDestroy, untrack } from 'svelte';
  import { slide } from 'svelte/transition';
  import { ORDER, player } from '../app/player.svelte.ts';
  import { ease, fileIcon, ICON, IR, STATUS_LETTER, t } from '../core/env.ts';
  import { fileBorn, fileGone } from '../core/timeline.ts';
  import { changedStatus, dirs, treeRows, type TreeRow } from '../core/tree.ts';
  import { FOLD_SELECT, FOLD_STEP } from '../../shared/timing.ts';
  import { chain, foldMoves } from '../../shared/tree-path.ts';

  const s = $derived(player.frame);
  const activeFile = $derived(s.panes[s.active].file);
  const target = $derived(s.exFocus || activeFile);
  const open = $derived(new Set(s.panes.flatMap((p) => p.tabs)));
  const count = (o: Record<string, number>) => (player.started ? Object.keys(o).filter((f) => o[f] <= player.T).length : -1);
  const born = $derived(count(fileBorn));
  const gone = $derived(count(fileGone));

  /** The walk in progress: which move (k) and how far into it (local, 0..1). */
  const motion = $derived.by(() => {
    const ex = s.exScroll;
    if (!ex) return null;
    const moves = foldMoves(dirs, ex.from, ex.file);
    const x = Math.max(0, ex.p) * moves.length;
    const k = Math.min(moves.length - 1, Math.floor(x));
    return { moves, k, local: ex.p >= 1 ? 1 : x - k, from: ex.from, key: ex.key };
  });
  /** Each move: the selection steps onto the row, then the folder opens or closes. */
  const stepP = (local: number) => ease(Math.min(1, local / FOLD_SELECT));
  /** Folders open on the timeline: the path of the file in view, or the walk between two paths. */
  const autoOpen = $derived.by(() => {
    if (!player.started) return new Set<string>();
    const m = motion;
    if (!m) return new Set(chain(dirs, target));
    const set = new Set(chain(dirs, m.from));
    m.moves.forEach((mv, j) => {
      if (j > m.k || (j === m.k && m.local < FOLD_SELECT)) return;
      if (mv.kind === 'close') set.delete(mv.path);
      else if (mv.kind === 'open') set.add(mv.path);
    });
    return set;
  });
  // once the viewer opens or closes a folder, the tree is theirs until playback resumes
  const expanded = $derived(player.manualTree ? player.expanded : autoOpen);
  const openKey = $derived([...expanded].sort().join('|'));
  const rows: TreeRow[] = $derived.by(() => {
    // recompute only when the tree's shape changes, not every frame
    void [born, s.exFocus, openKey, player.ui.exFilter, player.started];
    return untrack(() => treeRows(expanded, player.ui.exFilter, (p) => player.started && changedStatus(p) === 'added' && fileBorn[p] != null && fileBorn[p] > player.T && p !== s.exFocus));
  });
  const isGone = (p: string) => { void gone; return player.started && fileGone[p] != null && fileGone[p] <= player.T; };
  const onPath = (p: string) => !!target && (target === p || target.startsWith(p + '/'));
  /** The row the walk is on now: lit while everything else recedes. */
  const cur = $derived(motion && motion.local < 1 ? motion.moves[motion.k].path : null);
  // a folder opens or closes in what is left of its move
  // (paused, a seek lands at once: nothing would re-measure the rows after a slide ends)
  const rowDur = $derived(player.playing ? Math.round((FOLD_STEP * (1 - FOLD_SELECT) - 20) / player.speed) : 0);

  let body: HTMLDivElement | undefined = $state();
  let sel: HTMLDivElement | undefined = $state();

  function own() {
    if (player.manualTree) return;
    player.expanded.clear();
    for (const d of autoOpen) player.expanded.add(d);
    player.manualTree = true;
  }
  function toggleDir(path: string) {
    own();
    if (player.expanded.has(path)) player.expanded.delete(path); else player.expanded.add(path);
    player.commit();
  }
  function collapseAll() { own(); player.expanded.clear(); player.commit(); }

  // ---- layout: keep the row the walk is on in view
  let anim: { key: string; from: number; to: number } | null = null;
  let shown: string | null = null;
  // Scroll as little as needed: the row comes in a quarter of the height from the edge it
  // enters at. The list stays put when it can, so the selection itself is what moves on screen.
  const centred = (row: HTMLElement): number | null => {
    if (!body) return null;
    const b = body.getBoundingClientRect(), r = row.getBoundingClientRect();
    if (r.top >= b.top + 24 && r.bottom <= b.bottom - 24) return null; // already comfortably visible
    const m = body.clientHeight * 0.25;
    const y = r.top < b.top ? body.scrollTop + (r.top - b.top) - m : body.scrollTop + (r.bottom - b.bottom) + m;
    return Math.max(0, Math.min(y, body.scrollHeight - body.clientHeight));
  };
  const rowOf = (p: string | null | undefined) => (p && body ? body.querySelector<HTMLElement>(`.ex-row[data-path="${CSS.escape(p)}"]`) : null);
  const off = player.layout(ORDER.explorer, () => {
    if (!body) return;
    scroll();
    place();
  });
  // One selection that moves, instead of one row losing its highlight while another gains it:
  // an object that moves continuously is seen as the same thing going somewhere, so the eye
  // follows it up the old path and down the new one, and sees where the new file is.
  function place() {
    if (!sel) return;
    const m = motion;
    let y: number | null = null, o = 1;
    if (m) {
      const a = rowOf(m.k > 0 ? m.moves[m.k - 1].path : m.from), b = rowOf(m.moves[m.k].path);
      const q = stepP(m.local);
      if (b) { y = a ? a.offsetTop + (b.offsetTop - a.offsetTop) * q : b.offsetTop; if (!a && m.k === 0) o = q; }
      else if (a) y = a.offsetTop;
    } else if (target) {
      const r = rowOf(target);
      if (r) y = r.offsetTop;
    }
    sel.hidden = y == null || !player.started;
    if (y != null) { sel.style.transform = `translateY(${y.toFixed(1)}px)`; sel.style.opacity = o < 1 ? o.toFixed(3) : ''; }
  }
  function scroll() {
    if (!body) return;
    const m = motion;
    if (m) {
      // each move brings its row into view while the selection steps onto it
      const path = m.moves[m.k].path;
      const key = `${m.key}:${m.k}:${path}`;
      if (!anim || anim.key !== key) {
        const row = rowOf(path);
        const to = row ? centred(row) : null;
        anim = { key, from: body.scrollTop, to: to ?? body.scrollTop };
      }
      body.scrollTop = anim.from + (anim.to - anim.from) * stepP(m.local);
      shown = s.exScroll!.file;
      return;
    }
    anim = null;
    if (target && target !== shown) {
      // reached without a walk (a seek, a jump to a definition): keep it in view without animating
      shown = target;
      const row = rowOf(target);
      const to = row ? centred(row) : null;
      if (to != null) body.scrollTop = to;
    }
  }
  onDestroy(off);
</script>

<aside class="wt-explorer" aria-label={t('explorer.title')}>
  <div class="ex-head"><span>{t('explorer.title')}</span><span class="ex-actions">
    <button class="icon-btn sm" class:on={player.ui.exFilter} title={t('explorer.changedOnly')} onclick={() => { player.ui.exFilter = !player.ui.exFilter; player.commit(); }}>{@html ICON.filter}</button>
    <button class="icon-btn sm" title={t('explorer.collapseAll')} onclick={collapseAll}>{@html ICON.collapse}</button></span></div>
  <div class="ex-root"><span class="tw open">{@html ICON.chevron}</span>{(IR.tree?.root || t('explorer.repository')).toUpperCase()}</div>
  <div class="ex-body" class:spot={!!target && player.started} role="tree" bind:this={body}>
    <div class="ex-sel" bind:this={sel} hidden></div>
    {#each rows as r (r.path)}
      {@const pad = `padding-left:${8 + r.depth * 12}px`}
      <div class="ex-row-wrap" transition:slide={{ duration: rowDur }}>
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
