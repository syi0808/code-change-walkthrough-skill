<script lang="ts">
  // The voice when it has no code line to sit under (the scene's lead sentence, graph
  // scenes): a caption over the bottom of the editor, in a fixed layer (no layout shift).
  import { onDestroy } from 'svelte';
  import { ORDER, player } from '../app/player.svelte.ts';
  import { voiceHtml } from './voice-html.ts';

  const v = $derived(player.voice && !player.voicePlaced ? player.voice : null);
  let cap: HTMLDivElement | undefined = $state();
  const off = player.layout(ORDER.caption, () => {
    if (!cap || !v) return;
    const pr = document.querySelector('.wt-panes')!.getBoundingClientRect();
    Object.assign(cap.style, { left: `${pr.left + 24}px`, width: `${pr.width - 48}px`, top: `${pr.bottom - 24}px` });
  });
  onDestroy(off);
</script>

<div class="wt-caption" class:show={!!v} aria-live="polite" bind:this={cap}>
  {#if v}{#key v.key}<div class="cap-in swap">{@html voiceHtml(v)}</div>{/key}{/if}
</div>
