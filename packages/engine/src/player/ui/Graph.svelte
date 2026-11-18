<script lang="ts">
  // Relationship graph in a fixed layer with three homes: full (over the editor), mini
  // (docked in the outline panel as a structure map, never over code), panel (a card).
  import { onDestroy } from 'svelte';
  import { ORDER, player } from '../app/player.svelte.ts';
  import { ICON, t } from '../core/env.ts';
  import { graphSvg } from '../core/graph-layout.ts';
  import { scenes } from '../core/timeline.ts';

  const s = $derived(player.frame);
  const content = $derived(s.graph ?? (s.map && player.ui.map ? s.map : null));
  const mode = $derived(s.graph ? (s.graph.size === 'panel' ? 'panel' : 'full') : player.ui.mapExpanded ? 'full' : 'mini');
  const svg = $derived.by(() => { const c = content; return c ? graphSvg(c) : ''; });

  let box: HTMLDivElement | undefined = $state();
  function close() {
    if (!s.graph) { player.ui.map = false; player.ui.mapExpanded = false; player.commit(); return; }
    player.explore((st) => { st.graph = null; });
  }
  function toggleSize() { player.ui.mapExpanded = !player.ui.mapExpanded; player.ui.map = true; player.commit(); }

  let rectSig = '', hlSig = '';
  let lastBox: HTMLDivElement | undefined;
  const off = player.layout(ORDER.graph, () => {
    const slot = document.querySelector<HTMLElement>('.gd-map');
    const guide = document.querySelector('.wt-guide')!.getBoundingClientRect();
    const guideVisible = player.ui.guide && guide.width > 120;
    if (slot) slot.hidden = !(content && mode === 'mini' && guideVisible);
    if (!box || !content) return;
    if (box !== lastBox) { lastBox = box; rectSig = hlSig = ''; }
    const st = document.querySelector('.wt-panes')!.getBoundingClientRect();
    let r: { left: number; top: number; width: number; height: number };
    // full: room at the top for the heading band, where the narration is read. A fixed room,
    // so the graph does not move when a sentence is one line longer.
    const ed = document.querySelectorAll('.wt-panes .pane')[s.active]?.querySelector('.editor');
    const top = Math.max(st.top + 14, (ed ? ed.getBoundingClientRect().top : st.top) + 76);
    if (mode === 'full') r = { left: st.left + 14, top, width: st.width - 28, height: st.bottom - 14 - top };
    else if (mode === 'mini' && guideVisible && slot) { const g = slot.getBoundingClientRect(); r = { left: g.left, top: g.top, width: g.width, height: g.height }; }
    else if (mode === 'mini') r = { left: st.right - 254, top: st.top + 66, width: 240, height: 150 };
    else { const w = Math.min(620, st.width - 28); r = { left: st.right - 14 - w, top: st.top + 70, width: w, height: Math.min(340, st.height - 90) }; }
    const sig = [r.left, r.top, r.width, r.height].map(Math.round).join(',');
    if (sig !== rectSig) { rectSig = sig; Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` }); }
    // highlights: explicit during the graph's own scene; afterwards the map follows the active file
    const activeFile = s.panes[s.active].file;
    const open = new Set(s.panes.flatMap((p) => p.tabs));
    const hl = new Set(s.graph ? s.graph.highlight || [] : content.nodes.filter((n) => n.file && n.file === activeFile).map((n) => n.id));
    const nextFile = !s.graph && s.bridge ? scenes[s.scene].where : null;
    const sig2 = JSON.stringify([[...hl], mode, s.graph ? '' : [...open].join(','), nextFile, content.key]);
    if (sig2 === hlSig) return;
    hlSig = sig2;
    const dim = !!s.graph && hl.size > 0;
    box.querySelectorAll<SVGGElement>('.g-node').forEach((n) => {
      const on = hl.has(n.dataset.id || '');
      n.classList.toggle('on', on);
      n.classList.toggle('off', dim && !on);
      n.classList.toggle('visited', !s.graph && !!n.dataset.file && open.has(n.dataset.file) && !on);
      n.classList.toggle('next', !!nextFile && n.dataset.file === nextFile && !on);
    });
    box.querySelectorAll<SVGGElement>('.g-edge').forEach((e) => {
      const on = hl.has(`${e.dataset.from}->${e.dataset.to}`) || (hl.has(e.dataset.from || '') && hl.has(e.dataset.to || ''));
      e.classList.toggle('on', on);
      e.classList.toggle('off', dim && !on);
    });
  });
  onDestroy(off);

  function nodeClick(ev: MouseEvent) {
    const n = (ev.target as Element).closest<SVGGElement>('.g-node[data-file]');
    if (n?.dataset.file) player.exploreOpen(n.dataset.file);
  }
</script>

{#if content}
  {#key content.key}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="wt-graph in {mode}" bind:this={box} onclick={nodeClick}>
      <header><span class="t">{content.title}</span>
        {#if !(mode === 'panel' || (mode === 'full' && s.graph))}<button class="icon-btn sm" title={t('graph.size')} onclick={toggleSize}>{@html mode === 'mini' ? ICON.expand : ICON.shrink}</button>{/if}
        <button class="icon-btn sm" title={t('graph.close')} onclick={close}>{@html ICON.close}</button></header>
      <div class="gbody">{@html svg}</div>
    </div>
  {/key}
{/if}
