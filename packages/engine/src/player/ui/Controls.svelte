<script lang="ts">
  // Playback controls: transport buttons, the chapter-segmented timeline, time, speed, pause per scene.
  import { player, SPEEDS } from '../app/player.svelte.ts';
  import { clamp, fmt, ICON, IR, T_ } from '../core/env.ts';
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
    <button class="icon-btn" title="{T_('이전 장면', 'Previous scene')} (⇧←)" onclick={() => player.prevScene()}>{@html ICON.prev}</button>
    <button class="play" title="{T_('재생/일시정지', 'Play/Pause')} (Space)" onclick={() => player.toggle()}>{@html player.playing ? ICON.pause : ICON.play}</button>
    <button class="icon-btn" title="{T_('다음 장면', 'Next scene')} (⇧→)" onclick={() => player.nextScene()}>{@html ICON.next}</button>
    <button class="icon-btn" title={T_('처음부터', 'Restart')} onclick={() => player.gotoScene(0, true)}>{@html ICON.restart}</button>
  </div>
  <div class="scrub" role="slider" aria-label={T_('타임라인', 'Timeline')} aria-valuenow={Math.round((T / total) * 100)} tabindex="0" bind:this={scrub}
    onpointerdown={down} onpointermove={move} onpointerup={up} onkeydown={key}>
    <div class="track">{#each chapters as c (c.t0)}<div class="seg" title={c.title} style:flex={String(c.t1 - c.t0)}><div class="fill" style:width="{clamp((T - c.t0) / (c.t1 - c.t0), 0, 1) * 100}%"></div></div>{/each}</div>
    {#each ticks as left (left)}<div class="tick" style:left="{left}%"></div>{/each}
    <div class="knob" style:left="{(T / total) * 100}%"></div>
    <div class="tip" style:left="{tip.left}%">{tip.text}</div>
  </div>
  <div class="ctrl-right">
    <span class="time">{fmt(T)} / {fmt(total)}</span>
    <select aria-label={T_('배속', 'Speed')} value={String(player.speed)} onchange={(e) => player.setSpeed(Number(e.currentTarget.value))}>
      {#each SPEEDS as v (v)}<option value={String(v)}>{v}×</option>{/each}
    </select>
    <label title={T_('장면이 끝나면 자동으로 멈춥니다 (P)', 'Pause at the end of each scene (P)')}><input type="checkbox" bind:checked={player.segPause}> {T_('장면마다 멈춤', 'Pause per scene')}</label>
  </div>
  <div class="ctrl-hint">
    {#if player.atSceneEnd && !player.playing}<span class="cont">{T_('장면 끝: Space로 다음 장면', 'End of scene: Space to continue')}</span>{/if}
    <span><kbd>Space</kbd> {T_('재생/정지', 'play/pause')}</span><span><kbd>←</kbd><kbd>→</kbd> ±5s</span><span><kbd>⇧</kbd>+<kbd>←</kbd><kbd>→</kbd> {T_('장면 이동', 'scene')}</span><span><kbd>[</kbd><kbd>]</kbd> {T_('배속', 'speed')}</span><span>⌘/Ctrl+{T_('클릭: 정의로 이동', 'Click: definition')}</span>
    {#if player.userOps.length}<span class="cont">{T_('탐색 모드: 재생하면 장면으로 돌아갑니다', 'Exploring: play to return to the walkthrough')}</span>{/if}
  </div>
</footer>
