<script lang="ts">
  // Playback controls: transport buttons, the chapter-segmented timeline, time, speed, pause per scene.
  import { narrator } from '../app/narrator.svelte.ts';
  import { player, SPEEDS } from '../app/player.svelte.ts';
  import { clamp, fmt, ICON, IR, t } from '../core/env.ts';
  import { sceneAt, scenes, total } from '../core/timeline.ts';

  const T = $derived(player.T);
  const chapters = IR.chapters.map((ch, ci) => {
    const scs = scenes.filter((x) => x.ci === ci);
    return scs.length ? { title: ch.title || '', t0: scs[0].t0, t1: scs[scs.length - 1].t0 + scs[scs.length - 1].duration } : null;
  }).filter((x) => x !== null);
  const ticks = scenes.slice(1).filter((sc) => sc.si !== 0).map((sc) => (sc.t0 / total) * 100);

  let scrub: HTMLDivElement | undefined = $state();
  let tip = $state({ text: '', left: 0 });
  let dragging = false, wasPlaying = false;
  const tFromX = (x: number) => { const r = scrub!.getBoundingClientRect(); return clamp((x - r.left) / r.width, 0, 1) * total; };
  function down(e: PointerEvent) { dragging = true; wasPlaying = player.playing; scrub!.setPointerCapture(e.pointerId); player.seek(tFromX(e.clientX)); }
  function move(e: PointerEvent) {
    const t = tFromX(e.clientX);
    tip = { text: `${sceneAt(t) + 1}. ${scenes[sceneAt(t)].title || ''} · ${fmt(t)}`, left: (t / total) * 100 };
    if (dragging) player.seek(t);
  }
  function up() { dragging = false; if (wasPlaying) player.play(); }
  function key(e: KeyboardEvent) { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); player.seek(T + (e.key === 'ArrowLeft' ? -5000 : 5000), player.playing); } }
</script>

<footer class="wt-ctrl" class:paused-at-end={player.atSceneEnd && !player.playing}>
  <div class="ctrl-btns">
    <button class="icon-btn" title="{t('controls.prev')} (⇧←)" onclick={() => player.prevScene()}>{@html ICON.prev}</button>
    <button class="play" title="{t('controls.play')} (Space)" onclick={() => player.toggle()}>{@html player.playing ? ICON.pause : ICON.play}</button>
    <button class="icon-btn" title="{t('controls.next')} (⇧→)" onclick={() => player.nextScene()}>{@html ICON.next}</button>
    <button class="icon-btn" title={t('controls.restart')} onclick={() => player.gotoScene(0, true)}>{@html ICON.restart}</button>
  </div>
  <div class="scrub" role="slider" aria-label={t('controls.timeline')} aria-valuenow={Math.round((T / total) * 100)} tabindex="0" bind:this={scrub}
    onpointerdown={down} onpointermove={move} onpointerup={up} onkeydown={key}>
    <div class="track">{#each chapters as c (c.t0)}<div class="seg" title={c.title} style:flex={String(c.t1 - c.t0)}><div class="fill" style:width="{clamp((T - c.t0) / (c.t1 - c.t0), 0, 1) * 100}%"></div></div>{/each}</div>
    {#each ticks as left (left)}<div class="tick" style:left="{left}%"></div>{/each}
    <div class="knob" style:left="{(T / total) * 100}%"></div>
    <div class="tip" style:left="{tip.left}%">{tip.text}</div>
  </div>
  <div class="ctrl-right">
    <span class="time">{fmt(T)} / {fmt(total)}</span>
    {#if narrator.supported}<button class="icon-btn" class:on={narrator.on} title={t('controls.tts')} aria-label={t('controls.tts')} aria-pressed={narrator.on} onclick={() => { narrator.set(!narrator.on); player.commit(); }}>{@html narrator.on ? ICON.speaker : ICON.muted}</button>{/if}
    <select aria-label={t('controls.speed')} value={String(player.speed)} onchange={(e) => player.setSpeed(Number(e.currentTarget.value))}>
      {#each SPEEDS as v (v)}<option value={String(v)}>{v}×</option>{/each}
    </select>
    <label title={t('controls.segPauseHint')}><input type="checkbox" bind:checked={player.segPause}> {t('controls.segPause')}</label>
  </div>
  <div class="ctrl-hint">
    {#if player.atSceneEnd && !player.playing}<span class="cont">{t('controls.sceneEnd')}</span>{/if}
    <span><kbd>Space</kbd> {t('controls.hintPlay')}</span><span><kbd>←</kbd><kbd>→</kbd> ±5s</span><span><kbd>⇧</kbd>+<kbd>←</kbd><kbd>→</kbd> {t('controls.hintScene')}</span><span><kbd>[</kbd><kbd>]</kbd> {t('controls.hintSpeed')}</span><span>⌘/Ctrl+{t('controls.hintDefinition')}</span>
    {#if player.userOps.length}<span class="cont">{t('controls.exploring')}</span>{/if}
  </div>
</footer>
