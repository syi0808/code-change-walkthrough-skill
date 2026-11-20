<script lang="ts">
  // The walkthrough outline (right panel): overview, chapters with their scenes, recap.
  // The current scene moves after the screen has settled, and the panel keeps the sentence being
  // read in view, moving on the timeline clock. It is a reference the viewer may scroll at any time:
  // once they do, it stops following until they bring the current entry back into view, pick a
  // scene, or the next scene starts.
  import { onDestroy } from 'svelte';
  import { ORDER, player } from '../app/player.svelte.ts';
  import { clamp, fileIcon, fmt, ICON, IR, md, mdInline, t } from '../core/env.ts';
  import { replays, scenes, total, type SceneRT } from '../core/timeline.ts';
  import { Follow } from '../core/tween.ts';

  const meta = IR.meta || {};
  const s = $derived(player.frame);
  const cur = $derived(!player.started ? -1 : player.atEnd ? scenes.length : s.guideScene);
  const seen = $derived(player.started ? replays.filter((r) => r.end <= player.T).length : 0);
  let pinned = $state({ overview: false, recap: false });

  /** Narration as items revealed with the steps (sentences of prose, list bullets). */
  function narrationHtml(S: SceneRT): string {
    const items = S.cues.items;
    if (!items.length) return md(S.narration);
    let html = '', para = -1, inList = false;
    items.forEach((it, i) => {
      if (it.para !== para) {
        if (para >= 0) html += inList ? '</ul>' : '</p>';
        para = it.para; inList = it.kind === 'li';
        html += inList ? '<ul>' : '<p>';
      }
      const body = `<span class="sn" data-k="${i}">${mdInline(it.text)}</span>`;
      html += inList ? `<li class="sn-li" data-k="${i}">${body}</li>` : body + ' ';
    });
    return html + (inList ? '</ul>' : '</p>');
  }
  const chapters = IR.chapters.map((ch, ci) => ({ ch, ci, list: scenes.map((S, k) => ({ S, k })).filter((x) => x.S.ci === ci) }));

  /** Which narration item is current in the highlighted scene (classes are set on the static HTML). */
  const item = $derived.by(() => {
    if (cur < 0 || cur >= scenes.length || scenes[cur].auto || cur !== s.scene) return -1;
    let k = -1;
    scenes[cur].cues.times.forEach((t0, i) => { if (s.sceneT >= t0) k = i; });
    return k;
  });
  /** A hunk dot of a tour scene: done, being replayed, or still ahead. */
  const dot = (k: number, j: number) => {
    if (cur !== k || s.scene !== k) return cur > k ? 'on' : '';
    const x = scenes[k].timed.filter((t) => t.st.do === 'replay')[j];
    return !x ? '' : s.sceneT >= x.start + x.dur ? 'on' : s.sceneT >= x.start ? 'cur' : '';
  };

  let body: HTMLDivElement | undefined = $state();
  const tween = new Follow();
  let itemSig = '';
  /** The viewer scrolled the panel themselves: it does not follow until `cur` changes or the entry is back in view. */
  let held: number | null = null;
  const hold = () => { held = cur; };
  const off = player.layout(ORDER.guide, () => {
    if (!body) return;
    // narration item states on the current scene's static text
    const sig = `${cur}:${item}`;
    if (sig !== itemSig) {
      itemSig = sig;
      body.querySelectorAll('.sn-next, .sn-cur, .sn-past').forEach((e) => e.classList.remove('sn-next', 'sn-cur', 'sn-past'));
      const li = body.querySelector(`.gd-sc[data-scene="${cur}"]`);
      li?.querySelectorAll<HTMLElement>('.sn').forEach((e) => {
        const k = Number(e.dataset.k);
        const host = e.parentElement!.classList.contains('sn-li') ? e.parentElement! : e;
        host.classList.add(k > item ? 'sn-next' : k === item ? 'sn-cur' : 'sn-past');
      });
    }
    // keep the entry being read in view: the scene, and in it the sentence on screen (the active row)
    const scene = cur < 0 ? body.querySelector<HTMLElement>('.gd-overview') : cur >= scenes.length ? body.querySelector<HTMLElement>('.gd-recap') : body.querySelector<HTMLElement>(`.gd-sc[data-scene="${cur}"]`);
    if (!scene) return;
    const row = scene.querySelector<HTMLElement>('li.sn-cur, span.sn-cur');
    const b = body.getBoundingClientRect();
    const span = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return { top: body!.scrollTop + r.top - b.top, bottom: body!.scrollTop + r.bottom - b.top }; };
    const head = span(scene.querySelector<HTMLElement>('.gd-sc-h, .gd-sec-h') || scene);
    const want = row ? span(row) : span(scene);
    // the scene's title and the row together when they fit, else the row
    const top = row && want.bottom - head.top <= body.clientHeight - 32 ? head.top : want.top;
    const inView = want.top >= body.scrollTop + 8 && want.bottom <= body.scrollTop + body.clientHeight - 8;
    if (held !== null) {
      // following again once the viewer has brought the entry back into view, or the scene has changed
      if (held !== cur || inView) held = null;
      else return;
    }
    // the least movement from where the panel was that shows them (computed every frame, so a scene
    // that is still unfolding is followed to where it ends up)
    const y = tween.at(player.T, `${cur}:${item}:${player.epoch}`, body.scrollTop, (from) => {
      if (cur >= scenes.length) return top - 8;
      const lo = want.bottom + 16 - body!.clientHeight, hi = top - 8;
      return lo > hi ? hi : clamp(from, lo, hi);
    }, 320);
    if (Math.abs(body.scrollTop - y) > 0.5) body.scrollTop = y;
  });
  onDestroy(off);
  // what the viewer does to scroll it: the wheel, a touch, the scrollbar (a press on the panel itself), keys.
  // (Not every scroll event: the browser also scrolls it when an entry above folds, which is not the viewer.)
  $effect(() => {
    const el = body;
    if (!el) return;
    const press = (e: PointerEvent) => { if (e.target === el) hold(); };
    const key = (e: KeyboardEvent) => { if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(e.key)) hold(); };
    el.addEventListener('wheel', hold, { passive: true });
    el.addEventListener('touchmove', hold, { passive: true });
    el.addEventListener('pointerdown', press);
    el.addEventListener('keydown', key);
    return () => { el.removeEventListener('wheel', hold); el.removeEventListener('touchmove', hold); el.removeEventListener('pointerdown', press); el.removeEventListener('keydown', key); };
  });
</script>

<aside class="wt-guide" aria-label={t('guide.title')}>
  <div class="gd-head"><span>{t('guide.title')}</span><span class="gd-meta">
    {#if replays.length}{t('guide.changes', { seen, n: replays.length, time: fmt(total) })}{:else}{t('guide.scenes', { n: scenes.length, time: fmt(total) })}{/if}
  </span></div>
  <div class="gd-map" hidden></div>
  <div class="gd-body" bind:this={body}>
    <section class="gd-sec gd-overview" class:open={cur < 0 || pinned.overview}>
      <button class="gd-sec-h" onclick={() => (pinned.overview = !(cur < 0 || pinned.overview))}>{t('guide.overview')}</button>
      <div class="gd-detail"><div class="gd-inner">
        <div class="gd-text">{@html md(meta.summary || '')}</div>
        {#if meta.impact?.length}<div class="gd-impact"><b>{t('guide.impact')}</b><ul>{#each meta.impact as n, i (i)}<li class={n.effect ? `e-${n.effect}` : ''}>{#if n.effect}<span class="eff e-{n.effect}">{t(`impact.${n.effect}`)}</span>{/if}<span>{@html mdInline(n.text)}</span></li>{/each}</ul></div>{/if}
        {#if meta.strategy}<div class="gd-strategy"><b>{t('guide.order')}{meta.strategy.order ? ` · ${meta.strategy.order}` : ''}</b>{@html md(meta.strategy.rationale || '')}</div>{/if}
      </div></div>
    </section>
    <ol class="gd-chapters">
      {#each chapters as { ch, ci, list } (ci)}
        <li class="gd-ch" class:cur={cur >= 0 && cur < scenes.length && scenes[cur].ci === ci} class:done={cur >= 0 && list.every((x) => x.k < cur)}>
          <div class="gd-ch-h"><span class="no">{ci + 1}</span><span class="t">{ch.title || ''}</span></div>
          <ol class="gd-scenes">
            {#each list as { S, k } (k)}
              {#if S.auto && S.tour}
                {@const icon = fileIcon(S.tour.file.split('/').pop() || '')}
                <li class="gd-sc auto st-{IR.files[S.tour.file]?.status}" class:cur={k === cur} class:done={cur >= 0 && k < cur} data-scene={k}>
                  <button class="gd-sc-h" title={S.tour.file} onclick={() => player.gotoScene(k, false)}><span class="bullet"></span><span class="fi {icon[1]}">{icon[0]}</span><span class="t">{S.title}</span><span class="hk">{#each S.tour.hunks as _, j (j)}<i class={dot(k, j)}></i>{/each}</span><span class="dur">{fmt(S.duration)}</span></button>
                </li>
              {:else}
                <li class="gd-sc" class:cur={k === cur} class:done={cur >= 0 && k < cur} class:open={k === cur} data-scene={k}>
                  <button class="gd-sc-h" onclick={() => player.gotoScene(k, false)}><span class="bullet">{@html ICON.check}</span><span class="t">{S.title || S.id}</span><span class="dur">{fmt(S.duration)}</span></button>
                  <div class="gd-detail"><div class="gd-inner">
                    {#if S.goal}<div class="gd-goal"><b>{t('guide.goal')}</b>{S.goal}</div>{/if}
                    <div class="gd-text">{@html narrationHtml(S)}</div>
                    {#if k === cur && s.say}<div class="gd-say">{@html md(s.say)}</div>{/if}
                  </div></div>
                  <div class="gd-prog"><i style:width={k === cur && k === s.scene ? `${(s.sceneP * 100).toFixed(1)}%` : '0'}></i></div>
                </li>
              {/if}
            {/each}
          </ol>
        </li>
      {/each}
    </ol>
    <section class="gd-sec gd-recap" class:open={player.atEnd || pinned.recap} class:cur={player.atEnd}>
      <button class="gd-sec-h" onclick={() => (pinned.recap = !(player.atEnd || pinned.recap))}>{t('guide.recap')}</button>
      <div class="gd-detail"><div class="gd-inner">
        {#if meta.takeaways?.length}<h4>{t('guide.takeaways')}</h4><ul>{#each meta.takeaways as t, i (i)}<li>{@html mdInline(t)}</li>{/each}</ul>{/if}
        {#if meta.reviewFocus?.length}<h4>{t('guide.review')}</h4><ul class="rf">{#each meta.reviewFocus as t, i (i)}<li>{@html mdInline(t)}</li>{/each}</ul>{/if}
        <p class="muted">{t('guide.explore')}</p>
      </div></div>
    </section>
  </div>
  {#if IR.glossary?.length}
    <div class="gd-foot"><details><summary>{t('guide.glossary', { n: IR.glossary.length })}</summary><dl>{#each IR.glossary as g, i (i)}<dt>{g.term}</dt><dd>{g.definition}</dd>{/each}</dl></details></div>
  {/if}
</aside>
