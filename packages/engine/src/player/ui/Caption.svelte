<script lang="ts">
  // The heading band: one place, at the top of the code (under the question strip, the tabs and
  // the path), for everything said without a code line to sit under. Between scenes it carries
  // the bridge (why this comes next); then the scene's lead sentence; in graph scenes, the
  // narration. It unrolls downwards and rolls back up, and the code under it stays sharp:
  // a scene change is told next to the question, not in a card over the code.
  import { onDestroy } from 'svelte';
  import { ORDER, player } from '../app/player.svelte.ts';
  import { baseName, fileIcon, IR, mdInline, t } from '../core/env.ts';
  import { scenes } from '../core/timeline.ts';
  import { voiceHtml } from './voice-html.ts';

  const s = $derived(player.frame);
  const sc = $derived(scenes[s.scene]);
  /** Where the next scene sits in the overview: the pinned map's node for its file, and the edge into it. */
  const onMap = $derived.by(() => {
    const m = s.map;
    if (!m || !sc.where) return null;
    const n = m.nodes.find((x) => x.file === sc.where);
    if (!n) return null;
    const via = m.edges.find((e) => e.to === n.id && e.label)?.label || '';
    return { label: n.label || n.id, sub: n.sub || '', via };
  });
  const bridging = $derived(player.live && !!s.bridge && !sc.auto);
  const v = $derived(!bridging && player.voice && !player.voicePlaced ? player.voice : null);
  let cap: HTMLDivElement | undefined = $state();
  const off = player.layout(ORDER.caption, () => {
    if (!cap) return;
    // hang from the top of the active editor (under its tabs and path), across the panes
    const pr = document.querySelector('.wt-panes')!.getBoundingClientRect();
    const ed = document.querySelectorAll('.wt-panes .pane')[s.active]?.querySelector('.editor');
    const top = ed ? ed.getBoundingClientRect().top : pr.top;
    Object.assign(cap.style, { left: `${pr.left}px`, width: `${pr.width}px`, top: `${top}px` });
  });
  onDestroy(off);
</script>

<div class="wt-caption" class:show={bridging || !!v} class:bridge={bridging} aria-live="polite" bind:this={cap} style:opacity={v?.out ? (1 - v.out).toFixed(3) : null}>
  <div class="cap-band">
    {#if bridging}
      {#key s.scene}
        <div class="cap-in br swap">
          <div class="br-eyebrow">
            <span class="br-ch">{t('bridge.chapter', { n: sc.ci + 1, title: sc.chapter.title || '' })}</span>
            {#if onMap}<span class="br-map" title={t('bridge.onMap')}><span class="br-map-k">{t('bridge.onMap')}</span>{#if onMap.via}<span class="br-via">{onMap.via}</span>{/if}<b>{onMap.label}</b>{#if onMap.sub}<span class="br-sub">{onMap.sub}</span>{/if}</span>{/if}
          </div>
          {#if sc.bridge}<div class="br-why">{@html mdInline(sc.bridge)}</div>{/if}
          {#if sc.where}
            {@const icon = fileIcon(baseName(sc.where))}
            <div class="br-where"><span class="br-to">{t('bridge.next')}</span><span class="o-file" title={sc.where}><span class="fi {icon[1]}">{icon[0]}</span><span class="nm">{baseName(sc.where)}</span>{#if IR.files[sc.where]?.role}<span class="role">{IR.files[sc.where].role}</span>{/if}</span></div>
          {/if}
        </div>
      {/key}
    {:else if v}
      {#key v.key}<div class="cap-in swap">{@html voiceHtml(v)}</div>{/key}
    {/if}
  </div>
</div>
