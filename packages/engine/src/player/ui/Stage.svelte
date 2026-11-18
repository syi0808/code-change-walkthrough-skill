<script lang="ts">
  // The editor stage: orientation strip (where am I, what question), the panes, the
  // references peek, the bridge card between scenes, and the start overlay.
  import { player } from '../app/player.svelte.ts';
  import { baseName, fileIcon, fmt, ICON, IR, mdInline, T_ } from '../core/env.ts';
  import { scenes, total } from '../core/timeline.ts';
  import Pane from './Pane.svelte';

  let { panes = $bindable([]) }: { panes?: Pane[] } = $props();

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
  const sc = $derived(scenes[s.scene]);
  const prev = $derived(scenes[s.scene - 1]);
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
      {#if file}{#key file}<span class="swap-soft">{@render chip(file)}</span>{/key}{/if}
    {/if}
  </div>
  <div class="wt-panes" class:columns={s.layout === 'columns'}>
    <Pane idx={0} bind:this={panes[0]} />
    <Pane idx={1} bind:this={panes[1]} />
  </div>
  {#if s.refs}
    <div class="wt-refs in">
      <header><b>{s.refs.symbol || ''}</b><span>{s.refs.title || T_(`참조 ${s.refs.items.length}곳`, `${s.refs.items.length} references`)}</span></header>
      <ol>
        {#each s.refs.items as it, i (i)}
          <li class:on={i === s.refs.active} class:seen={i < s.refs.active}><button onclick={() => player.exploreOpen(it.file, { line: it.line, side: it.side, view: it.view })}>
            <span class="loc">{baseName(it.file)}<i>:{it.line}</i></span><span class="snip">{it.text}{#if it.label}<span class="lbl">{it.label}</span>{/if}</span>
          </button></li>
        {/each}
      </ol>
    </div>
  {/if}
  {#if s.toast}{#key s.toast}<div class="wt-toast in">{s.toast}</div>{/key}{/if}

  <div class="wt-bridge" class:show={player.live && !!s.bridge} aria-live="polite">
    {#if player.live && !sc.auto}
      {#key s.scene}
        <div class="br-card">
          <div class="br-eyebrow">{#if sc.si === 0}<span class="br-ch">{T_('챕터', 'Chapter')} {sc.ci + 1} · {sc.chapter.title || ''}</span>{:else}<span>{sc.chapter.title || ''}</span>{/if}<span class="br-n">{s.scene + 1}/{scenes.length}</span></div>
          {#if prev}<div class="br-from">{T_('방금', 'Just saw')}: {prev.title || ''}</div>{/if}
          {#if sc.bridge}<div class="br-why">{@html mdInline(sc.bridge)}</div>{/if}
          <div class="br-title">{@html mdInline(sc.question || sc.title || '')}</div>
          {#if sc.question && sc.title}<div class="br-sub">{sc.title}</div>{/if}
          {#if sc.where}<div class="br-where">{@render chip(sc.where)}</div>{/if}
        </div>
      {/key}
    {/if}
  </div>
  <div class="wt-start" class:gone={player.started}>
    <button aria-label="play" onclick={() => player.play()}>{@html ICON.play}</button>
    <div class="t">{meta.title || ''}</div>
    <div class="s">{scenes.length} {T_('장면', 'scenes')} · {T_('약', '~')} {fmt(total)} · {T_('Space로 시작', 'Space to start')}</div>
  </div>
</section>
