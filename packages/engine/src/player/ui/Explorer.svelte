<script lang="ts">
  // VS Code-like explorer. While a file is being picked, everything but its path recedes,
  // and the explorer scrolls the row into view on the timeline clock (the "locate" phase).
  import { onDestroy, untrack } from 'svelte';
  import { slide } from 'svelte/transition';
  import { ORDER, player } from '../app/player.svelte.ts';
  import { fileIcon, ICON, IR, STATUS_LETTER, T_ } from '../core/env.ts';
  import { fileBorn, fileGone } from '../core/timeline.ts';
  import { changedStatus, treeRows, type TreeRow } from '../core/tree.ts';

  const s = $derived(player.frame);
  const activeFile = $derived(s.panes[s.active].file);
  const target = $derived(s.exFocus || activeFile);
  const open = $derived(new Set(s.panes.flatMap((p) => p.tabs)));
  const count = (o: Record<string, number>) => (player.started ? Object.keys(o).filter((f) => o[f] <= player.T).length : -1);
  const born = $derived(count(fileBorn));
  const gone = $derived(count(fileGone));
  const rows: TreeRow[] = $derived.by(() => {
    // recompute only when the tree's shape changes, not every frame
    void [born, s.exFocus, player.expanded.size, player.ui.exFilter, player.started];
    for (const _ of player.expanded) void _;
    return untrack(() => treeRows(player.expanded, player.ui.exFilter, (p) => player.started && changedStatus(p) === 'added' && fileBorn[p] != null && fileBorn[p] > player.T && p !== s.exFocus));
  });
  const isGone = (p: string) => { void gone; return player.started && fileGone[p] != null && fileGone[p] <= player.T; };
  const onPath = (p: string) => !!target && (target === p || target.startsWith(p + '/'));
  const rowDur = $derived(Math.round(200 / player.speed));

  let body: HTMLDivElement | undefined = $state();

  function toggleDir(path: string) {
    if (player.expanded.has(path)) player.expanded.delete(path); else player.expanded.add(path);
    player.commit();
  }
  function collapseAll() { player.expanded.clear(); player.commit(); }

  // ---- layout: scroll the target row into view
  let anim: { key: string; from: number; to: number } | null = null;
  let shown: string | null = null;
  const centred = (row: HTMLElement): number | null => {
    if (!body) return null;
    const b = body.getBoundingClientRect(), r = row.getBoundingClientRect();
    if (r.top >= b.top + 24 && r.bottom <= b.bottom - 24) return null; // already comfortably visible
    return Math.max(0, body.scrollTop + (r.top - b.top) - body.clientHeight / 2 + r.height / 2);
  };
  const off = player.layout(ORDER.explorer, () => {
    if (!body) return;
    const ex = s.exScroll;
    const rowOf = (p: string) => body!.querySelector<HTMLElement>(`.ex-row[data-file="${CSS.escape(p)}"]`);
    if (ex) {
      // the locate phase: only the explorer moves, at timeline speed
      const key = `${ex.key}:${ex.file}`;
      if (!anim || anim.key !== key) {
        const row = rowOf(ex.file);
        const to = row ? centred(row) : null;
        anim = { key, from: body.scrollTop, to: to ?? body.scrollTop };
      }
      body.scrollTop = anim.from + (anim.to - anim.from) * ex.p;
      shown = ex.file;
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
  });
  onDestroy(off);
</script>

<aside class="wt-explorer" aria-label={T_('탐색기', 'Explorer')}>
  <div class="ex-head"><span>{T_('탐색기', 'Explorer')}</span><span class="ex-actions">
    <button class="icon-btn sm" class:on={player.ui.exFilter} title={T_('변경된 파일만 보기', 'Show changed files only')} onclick={() => { player.ui.exFilter = !player.ui.exFilter; player.commit(); }}>{@html ICON.filter}</button>
    <button class="icon-btn sm" title={T_('모두 접기', 'Collapse all')} onclick={collapseAll}>{@html ICON.collapse}</button></span></div>
  <div class="ex-root"><span class="tw open">{@html ICON.chevron}</span>{(IR.tree?.root || T_('저장소', 'repository')).toUpperCase()}</div>
  <div class="ex-body" class:spot={!!target && player.started} role="tree" bind:this={body}>
    {#each rows as r (r.path)}
      {@const pad = `padding-left:${8 + r.depth * 12}px`}
      <div class="ex-row-wrap" in:slide={{ duration: rowDur }}>
        {#if r.kind === 'more'}
          <div class="ex-row more" style={pad}>{#each { length: r.depth } as _, k}<span class="ig" style="left:{14 + k * 12}px"></span>{/each}<span class="tw"></span><span class="nm">{T_('(일부 파일 생략)', '(some files omitted)')}</span></div>
        {:else if r.kind === 'dir'}
          <div class="ex-row dir" class:has-changes={!!r.changed} class:path={onPath(r.path)} role="treeitem" aria-selected="false" aria-expanded={r.open} tabindex="-1" title={r.path} style={pad}
            onclick={() => toggleDir(r.path)} onkeydown={(e) => e.key === 'Enter' && toggleDir(r.path)}>
            {#each { length: r.depth } as _, k}<span class="ig" style="left:{14 + k * 12}px"></span>{/each}<span class="tw" class:open={r.open}>{@html ICON.chevron}</span><span class="nm">{r.label}</span>{#if r.changed}<span class="dot"></span>{/if}
          </div>
        {:else}
          {@const icon = fileIcon(r.label)}
          <div class="ex-row file{r.status ? ` st-${r.status}` : ''}" class:gone={isGone(r.path)} class:open={open.has(r.path)} class:active={r.path === activeFile && !s.exFocus} class:selecting={r.path === s.exFocus} class:target={r.path === target} class:stub={!r.embedded}
            role="treeitem" aria-selected={r.path === activeFile} tabindex="-1" data-file={r.path} style={pad} title={r.path + (r.embedded ? '' : ': ' + T_('내용 미포함', 'content not embedded'))}
            onclick={() => player.exploreOpen(r.path)} onkeydown={(e) => e.key === 'Enter' && player.exploreOpen(r.path)}>
            {#each { length: r.depth } as _, k}<span class="ig" style="left:{14 + k * 12}px"></span>{/each}<span class="tw"></span><span class="fi {icon[1]}">{icon[0]}</span><span class="nm">{r.label}</span>{#if r.status}<span class="sb">{STATUS_LETTER[r.status] || ''}</span>{/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
</aside>
