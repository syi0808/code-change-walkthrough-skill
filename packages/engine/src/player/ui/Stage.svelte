<script lang="ts">
  // The editor stage: orientation strip (where am I, what question), the panes, the
  // references peek, and the start overlay. The bridge between scenes is told in the heading
  // band under the strip (Caption.svelte).
  import { player } from '../app/player.svelte.ts';
  import { baseName, clamp, ease, fileIcon, fmt, ICON, IR, mdInline, t } from '../core/env.ts';
  import { scenes, total } from '../core/timeline.ts';
  import Pane from './Pane.svelte';

  let { panes = $bindable([]) }: { panes?: Pane[] } = $props();
  /** How long a command's name stays (ms of timeline time). */
  const TOAST_MS = 2400;

  const meta = IR.meta || {};
  const s = $derived(player.frame);
  const shown = $derived(scenes[s.shown]);
  const file = $derived(s.panes[s.active].file);
  /** In a tour scene: which of the file's hunks is being replayed. */
  const hunk = $derived.by(() => {
    if (!shown.auto || !shown.tour) return null;
    let h: number | null = null;
    if (s.shown === s.scene) for (const x of shown.timed) if (x.st.do === 'replay' && s.sceneT >= x.start) h = x.st.hunk ?? null;
    return `${h || shown.tour.hunks[0]}/${shown.tour.of}`;
  });
</script>

{#snippet chip(path: string)}
  {@const icon = fileIcon(baseName(path))}
  <span class="o-file" title={path}><span class="fi {icon[1]}">{icon[0]}</span><span class="nm">{baseName(path)}</span>{#if IR.files[path]?.role}<span class="role">{IR.files[path].role}</span>{/if}</span>
{/snippet}

<section class="wt-stage" class:bridging={player.live && !!s.bridge}>
  <div class="wt-orient" aria-live="polite">
    {#if player.live}
      <span class="o-pos"><b>{s.shown + 1}</b>/{scenes.length}</span>
      {#key s.shown}
        <span class="o-q swap">{#if shown.question}<span class="q">Q</span>{@html mdInline(shown.question)}{:else}{shown.title || ''}{/if}</span>
      {/key}
      <span class="o-spacer"></span>
      {#if hunk}<span class="o-hunk">hunk {hunk}</span>{/if}
      <!-- in a drill-down: where it will come back to (a cue for resuming the line it left) -->
      {#if s.detour}<span class="o-detour swap-soft" title={`${s.detour.file}:${s.detour.line}`}><span class="k">↩ {t('detour.back')}</span><b>{baseName(s.detour.file)}:{s.detour.line}</b></span>{/if}
      {#if file}{#key file}<span class="swap-soft">{@render chip(file)}</span>{/key}{/if}
    {/if}
  </div>
  <!-- a second group slides in and out on the timeline (s.split), so its opening and closing are seen as events -->
  <div class="wt-panes" class:columns={s.layout === 'columns'} style:grid-template-columns={s.layout === 'columns' && s.split < 1 ? `minmax(0, 1fr) minmax(0, ${ease(s.split).toFixed(4)}fr)` : null}>
    <Pane idx={0} bind:this={panes[0]} />
    <Pane idx={1} bind:this={panes[1]} />
  </div>
  {#if s.refs}
    {@const impact = s.refs.kind === 'impact'}
    <div class="wt-refs in" class:impact>
      {#if impact}
        <header><span class="kind">{t('impact.title')}</span>{#if s.refs.symbol}<b>{s.refs.symbol}</b>{/if}{#if s.refs.change}<span class="chg">{s.refs.change}</span>{/if}
          <span class="sum">{s.refs.title || t('impact.summary', { outside: s.refs.items.filter((x) => x.outside).length, n: s.refs.items.length })}</span></header>
      {:else}
        <header><b>{s.refs.symbol || ''}</b><span>{s.refs.title || t('refs.count', { n: s.refs.items.length })}</span></header>
      {/if}
      <ol>
        {#each s.refs.items as it, i (i)}
          <li class:on={i === s.refs.active} class:seen={i < s.refs.active}><button onclick={() => player.exploreOpen(it.file, { line: it.line, side: it.side, view: it.view })}>
            <span class="loc">{baseName(it.file)}<i>:{it.line}</i></span>
            {#if impact}
              <span class="where">{#if it.outside}<span class="out">{t('impact.outside')}</span>{:else}<span class="in">{t('impact.inDiff')}</span>{/if}{#if it.relation}<span class="rel">{it.relation}</span>{/if}</span>
              <span class="snip">{it.label || it.text}</span>
              {#if it.effect}<span class="eff e-{it.effect}">{t(`impact.${it.effect}`)}</span>{:else}<span></span>{/if}
            {:else}
              <span class="snip">{it.text}{#if it.label}<span class="lbl">{it.label}</span>{/if}</span>
            {/if}
          </button></li>
        {/each}
      </ol>
    </div>
  {/if}
  <!-- a command's name, for a moment after it runs: it then fades (timeline time), so it never stays over the code's header -->
  {#if s.toast && s.sceneT - s.toastAt < TOAST_MS}{#key s.toast}<div class="wt-toast in" style:opacity={clamp((TOAST_MS - (s.sceneT - s.toastAt)) / 400, 0, 1).toFixed(3)}>{s.toast}</div>{/key}{/if}

  <div class="wt-start" class:gone={player.started}>
    <button aria-label="play" onclick={() => player.play()}>{@html ICON.play}</button>
    <div class="t">{meta.title || ''}</div>
    <div class="s">{t('start.summary', { n: scenes.length, time: fmt(total) })}</div>
  </div>
</section>
