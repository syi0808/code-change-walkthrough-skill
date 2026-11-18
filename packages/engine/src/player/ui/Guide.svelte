<script lang="ts">
  // The walkthrough outline (right panel): overview, chapters with their scenes, recap.
  // The current scene moves after the screen has settled, and the panel scrolls to it on
  // the timeline clock, so it never moves at the same moment as the code.
  import { onDestroy } from 'svelte';
  import { ORDER, player } from '../app/player.svelte.ts';
  import { fileIcon, fmt, ICON, IR, md, mdInline, T_ } from '../core/env.ts';
  import { replays, scenes, total, type SceneRT } from '../core/timeline.ts';
  import { Tween } from '../core/tween.ts';

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
  const tween = new Tween();
  let itemSig = '';
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
    // keep the current entry in view, moving on the timeline clock
    const target = cur < 0 ? body.querySelector<HTMLElement>('.gd-overview') : cur >= scenes.length ? body.querySelector<HTMLElement>('.gd-recap') : body.querySelector<HTMLElement>(`.gd-sc[data-scene="${cur}"]`);
    if (!target) return;
    const y = tween.at(player.T, `${cur}:${player.epoch}`, body.scrollTop, () => {
      const b = body!.getBoundingClientRect(), r = target.getBoundingClientRect();
      const top = body!.scrollTop + r.top - b.top;
      if (cur >= scenes.length) return top - 8;
      if (r.top < b.top + 8) return top - 8;
      if (r.bottom > b.bottom - 8) return top + r.height - body!.clientHeight + 24;
      return body!.scrollTop;
    }, 260);
    if (Math.abs(body.scrollTop - y) > 0.5) body.scrollTop = y;
  });
  onDestroy(off);
</script>

<aside class="wt-guide" aria-label={T_('워크스루', 'Walkthrough')}>
  <div class="gd-head"><span>{T_('워크스루', 'Walkthrough')}</span><span class="gd-meta">
    {#if replays.length}{T_('변경', 'Changes')} <b>{seen}</b>/{replays.length} hunk · {fmt(total)}{:else}{scenes.length} {T_('장면', 'scenes')} · {fmt(total)}{/if}
  </span></div>
  <div class="gd-map" hidden></div>
  <div class="gd-body" bind:this={body}>
    <section class="gd-sec gd-overview" class:open={cur < 0 || pinned.overview}>
      <button class="gd-sec-h" onclick={() => (pinned.overview = !(cur < 0 || pinned.overview))}>{T_('개요', 'Overview')}</button>
      <div class="gd-detail"><div class="gd-inner">
        <div class="gd-text">{@html md(meta.summary || '')}</div>
        {#if meta.strategy}<div class="gd-strategy"><b>{T_('진행 방식', 'How this is ordered')}{meta.strategy.order ? ` · ${meta.strategy.order}` : ''}</b>{@html md(meta.strategy.rationale || '')}</div>{/if}
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
                    {#if S.goal}<div class="gd-goal"><b>{T_('목표', 'Goal')}</b>{S.goal}</div>{/if}
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
      <button class="gd-sec-h" onclick={() => (pinned.recap = !(player.atEnd || pinned.recap))}>{T_('정리', 'Recap')}</button>
      <div class="gd-detail"><div class="gd-inner">
        {#if meta.takeaways?.length}<h4>{T_('핵심 요약', 'Key takeaways')}</h4><ul>{#each meta.takeaways as t, i (i)}<li>{@html mdInline(t)}</li>{/each}</ul>{/if}
        {#if meta.reviewFocus?.length}<h4>{T_('리뷰 때 확인할 것', 'Review checklist')}</h4><ul class="rf">{#each meta.reviewFocus as t, i (i)}<li>{@html mdInline(t)}</li>{/each}</ul>{/if}
        <p class="muted">{T_('일시정지 중에는 탐색기에서 파일을 열거나 ⌘/Ctrl+클릭으로 정의로 이동할 수 있습니다.', 'While paused, open files from the explorer or ⌘/Ctrl+Click to go to a definition.')}</p>
      </div></div>
    </section>
  </div>
  {#if IR.glossary?.length}
    <div class="gd-foot"><details><summary>{T_('용어', 'Glossary')} ({IR.glossary.length})</summary><dl>{#each IR.glossary as g, i (i)}<dt>{g.term}</dt><dd>{g.definition}</dd>{/each}</dl></details></div>
  {/if}
</aside>
