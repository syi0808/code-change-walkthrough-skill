<script lang="ts">
  // One editor pane: tabs, breadcrumbs with diffstat, and the code view (plain or diff).
  import { onDestroy } from 'svelte';
  import { ORDER, player } from '../app/player.svelte.ts';
  import { decorate, pointedRanges } from '../core/decorate.ts';
  import { baseName, easeOut, fileIcon, IR, STATUS_LETTER, t } from '../core/env.ts';
  import { foldsOf, model, modelRowsOf, rangeRows, viewOf, type CodeView } from '../core/model.ts';
  import { NoteTracker, type NoteView } from '../core/notes.ts';
  import { scrollFrame } from '../core/scroll.ts';
  import { voiceHtml } from './voice-html.ts';

  let { idx }: { idx: 0 | 1 } = $props();

  const s = $derived(player.frame);
  const ps = $derived(s.panes[idx]);
  const isActive = $derived(idx === s.active);
  const f = $derived(ps.file ? IR.files[ps.file] ?? null : null);
  const m = $derived(ps.file && f ? model(ps.file, ps.view, ps.diff) : null);
  const folds = $derived(m ? foldsOf(m, ps.view === 'diff' ? ps.diff.context : null) : []);
  /** Folds the viewer opened by hand, per model. */
  let userExpanded = $state<Record<string, number[]>>({});

  // Folds open wherever the walkthrough points. Rows of a fold that opens while the same
  // file stays on screen grow in; a freshly opened file shows its rows at once.
  let lastView: CodeView | null = null;
  const fresh = { folds: new Set<number>() }; // not reactive on purpose: read together with `v`
  const v = $derived.by(() => {
    if (!m) return null;
    const exp = new Set(userExpanded[m.key] || []);
    if (folds.length) for (const r of pointedRanges(ps, s)) {
      const span = modelRowsOf(m, r);
      if (span) for (const fd of folds) if (fd.a <= span[1] && span[0] <= fd.b) exp.add(fd.id);
    }
    const nv = viewOf(m, folds, exp);
    if (nv !== lastView) {
      const prevOpen = new Set<number>();
      if (lastView && lastView.key.startsWith(m.key + '#')) for (const vr of lastView.rows) if (vr.unfolded != null) prevOpen.add(vr.unfolded);
      fresh.folds = lastView && lastView.key.startsWith(m.key + '#') ? new Set([...exp].filter((id) => !prevOpen.has(id))) : new Set();
      lastView = nv;
    }
    return nv;
  });
  const deco = $derived(m && v ? decorate(ps, s, m, v) : null);

  // ---- the voice under its line (one at a time), opening and closing on the timeline clock
  const tracker = new NoteTracker();
  const notes = $derived.by(() => {
    const vo = player.voice;
    let next = null;
    if (isActive && vo && vo.anchor && v) {
      const vi = v.idx[vo.anchor.side].get(vo.anchor.line);
      if (vi != null) next = { key: vo.key, vi, html: voiceHtml(vo), tone: vo.kind === 'note' ? vo.tone : undefined };
    }
    const list = tracker.update(player.T, next, !player.playing);
    const at = new Map<number, NoteView[]>();
    for (const n of list) at.set(n.vi, [...(at.get(n.vi) || []), n]);
    return at;
  });

  const enter = $derived(ps.enter ? easeOut(ps.enter.p) : 1);
  /** A long scroll dims the code around its cut (see scrollFrame). */
  let dim = $state(0);
  const stat = $derived.by(() => {
    if (!m) return null;
    const total = m.adds + m.dels;
    if (!total) return null;
    const a = Math.round((m.adds / total) * 5);
    return { adds: m.adds, dels: m.dels, blocks: Array.from({ length: 5 }, (_, i) => (i < a ? 'a' : 'd')) };
  });
  const canDiff = $derived(!!f && f.before != null && f.after != null && f.status !== 'context');

  let tabsEl: HTMLDivElement | undefined = $state();
  let editorEl: HTMLDivElement | undefined = $state();
  let codeEl: HTMLDivElement | undefined = $state();
  let tokEl: HTMLDivElement | undefined = $state();
  const rowEls: HTMLElement[] = $state([]);

  function setView(view: string) {
    player.explore((st) => {
      const p = st.panes[idx];
      if (view === 'unified' || view === 'split') { p.view = 'diff'; p.diff.mode = view; } else p.view = view as 'after' | 'before';
    });
  }
  function openFold(id: number) {
    if (!m) return;
    userExpanded[m.key] = [...(userExpanded[m.key] || []), id];
    player.commit();
  }

  // ---- layout: scroll (after the DOM is updated), then caret / labels / Cmd underline
  let scrollSig = '';
  let tabSig = '';
  // A move starts where the editor really is. Recomputing its start from the previous target
  // can disagree with the screen by a few rows (an explanation moved meanwhile), and the first
  // frame then jumps, often the wrong way.
  let move: { key: string; from: number; p: number } | null = null;
  const offScroll = player.layout(ORDER.pane, () => {
    if (!editorEl || !codeEl || !v || !ps.scroll) return;
    const sig = JSON.stringify([ps.scroll.to, ps.scroll.mode, ps.scroll.p, v.key, notes.size, deco?.caret, deco?.head?.vi, deco?.head?.g, player.epoch]);
    if (sig === scrollSig && !player.playing) return;
    scrollSig = sig;
    const key = JSON.stringify([ps.file, ps.view, ps.scroll.to, ps.scroll.mode]);
    // a new move: another target, or the same target set again by the next step (its progress restarts)
    if (!move || move.key !== key || ps.scroll.p < move.p) move = { key, from: editorEl.scrollTop, p: ps.scroll.p };
    move.p = ps.scroll.p;
    // while playing, a move (and where it settles) is measured from where it really began;
    // a seek shows the state as computed
    const live = player.playing && ps.scroll.mode !== 'follow';
    if (!live) move = { key, from: NaN, p: ps.scroll.p };
    const E = { view: v, row: (i: number) => rowEls[i], height: editorEl.clientHeight, contentHeight: codeEl.scrollHeight, head: deco?.head, rowH: parseFloat(getComputedStyle(editorEl).lineHeight) || 20 };
    const fr = scrollFrame(E, ps.scroll, Number.isNaN(move.from) ? null : move.from);
    if (fr.y != null && Math.abs(editorEl.scrollTop - fr.y) > 0.5) editorEl.scrollTop = fr.y;
    dim = fr.dim;
  });
  const offDeco = player.layout(ORDER.decorations, () => {
    if (tabsEl && tabSig !== ps.file + '|' + ps.tabs.length) { tabSig = ps.file + '|' + ps.tabs.length; tabsEl.querySelector('.tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    if (!codeEl || !editorEl || !v || !deco) return;
    codeEl.style.setProperty('--vw', `${editorEl.clientWidth + editorEl.scrollLeft}px`);
    // typing caret: clip the line at the typed character (measured, so wide glyphs work)
    codeEl.querySelectorAll('.txt.clip').forEach((t) => t.classList.remove('clip'));
    for (const c of deco.caret) {
      const row = rowEls[c.vi];
      const txt = (c.half ? row?.querySelectorAll('.txt')[1] : row?.querySelector('.txt')) as HTMLElement | undefined;
      if (!txt) continue;
      txt.style.setProperty('--clipx', `${Math.max(0, offsetX(txt, c.offset))}px`);
      txt.classList.add('clip');
    }
    // Cmd-hover underline under the token about to be clicked
    if (tokEl) {
      const a = ps.tokline;
      const r = a ? tokenRect(a.side, a.line, a.token) : null;
      tokEl.hidden = !r;
      if (r) Object.assign(tokEl.style, { left: `${r.left}px`, top: `${r.bottom - 1}px`, width: `${r.width}px` });
    }
  });
  onDestroy(() => { offScroll(); offDeco(); });

  function locate(root: Node, offset: number): [Node, number] | null {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n: Node | null, acc = 0, last: Text | null = null;
    while ((n = w.nextNode())) { const t = n as Text; last = t; if (acc + t.length >= offset) return [t, offset - acc]; acc += t.length; }
    return last ? [last, last.length] : null;
  }
  function offsetX(txt: HTMLElement, offset: number): number {
    const pos = locate(txt, offset);
    if (!pos) return 0;
    const rg = document.createRange(); rg.setStart(pos[0], pos[1]); rg.setEnd(pos[0], pos[1]);
    return rg.getBoundingClientRect().left - txt.getBoundingClientRect().left;
  }
  /** Rectangle of a token on a line (relative to the code box), for the pointer and the underline. */
  export function tokenRect(side: 'before' | 'after', line: number, token?: string): { left: number; top: number; bottom: number; width: number; abs: DOMRect } | null {
    if (!v || !codeEl) return null;
    const rs = rangeRows(v, { side, from: line, to: line });
    const row = rs.length ? rowEls[rs[0]] : undefined;
    if (!row) return null;
    let txt = row.querySelector('.txt') as HTMLElement | null;
    if (row.classList.contains('split')) txt = (row.querySelectorAll('.txt')[side === 'before' ? 0 : 1] as HTMLElement) || txt;
    if (!txt) return null;
    const at = token ? (txt.textContent || '').indexOf(token) : -1;
    let rect: DOMRect | null = null;
    if (at >= 0 && token) {
      const s0 = locate(txt, at), e0 = locate(txt, at + token.length);
      if (s0 && e0) { const range = document.createRange(); range.setStart(s0[0], s0[1]); range.setEnd(e0[0], e0[1]); rect = range.getBoundingClientRect(); }
    }
    if (!rect || !rect.width) rect = txt.getBoundingClientRect();
    const base = codeEl.getBoundingClientRect();
    return { left: rect.left - base.left, top: rect.top - base.top, bottom: rect.bottom - base.top, width: Math.min(rect.width, 400), abs: rect };
  }
  export const editorBox = (): DOMRect | null => editorEl?.getBoundingClientRect() ?? null;
  export const tabBox = (file: string): { tab: DOMRect; strip: DOMRect } | null => {
    const tab = tabsEl?.querySelector(`.tab[data-file="${CSS.escape(file)}"]`);
    return tab && tabsEl ? { tab: tab.getBoundingClientRect(), strip: tabsEl.getBoundingClientRect() } : null;
  };
</script>

<div class="pane" class:active={isActive && s.layout === 'columns'}>
  <div class="tabs" bind:this={tabsEl}>
    {#each ps.tabs as file (file)}
      {@const st = IR.files[file]?.status}
      {@const icon = fileIcon(baseName(file))}
      {@const on = file === ps.file}
      <button class="tab{st && st !== 'context' ? ` st-${st}` : ''}" class:on class:outside={st === 'context'} data-file={file} title={file} onclick={() => player.exploreOpen(file, { pane: idx })}>
        <span class="fi {icon[1]}">{icon[0]}</span><span class="nm">{baseName(file)}</span>
        {#if on && ps.view !== 'after'}<span class="mode">{ps.view === 'diff' ? 'diff' : t('pane.before')}</span>{/if}
        {#if st && STATUS_LETTER[st]}<span class="sb">{STATUS_LETTER[st]}</span>{/if}
      </button>
    {/each}
  </div>
  {#if !ps.file}
    <div class="editor"><div class="empty-pane">{t('pane.empty')}</div></div>
  {:else if !f}
    <div class="crumbs"><span class="path">{#each ps.file.split('/') as part, i}{#if i}<i>›</i>{/if}{part}{/each}</span></div>
    <div class="editor"><div class="empty-pane stub"><div>{t('pane.stub')}</div><div class="muted">{t('pane.stubHint')}</div></div></div>
  {:else if m && v && deco}
    <div class="crumbs">
      <span class="path">{#each ps.file.split('/') as part, i}{#if i}<i>›</i>{/if}{part}{/each}</span>
      {#if f.status === 'context'}<span class="outside" title={t('pane.outsideHint')}>{t('pane.outside')}</span>{/if}
      {#if f.oldPath}<span class="sym">← {f.oldPath}</span>{/if}
      {#if f.role}<span class="sym">{f.role}</span>{/if}
      <span class="vbtns">
        {#if stat}<span class="dstat"><span class="pa">+{stat.adds}</span><span class="pd">−{stat.dels}</span><span class="sq">{#each stat.blocks as b, i (i)}<i class={b}></i>{/each}</span></span>{/if}
        {#if canDiff}
          {#each [['after', t('pane.after')], ['before', t('pane.before')], ['unified', 'unified'], ['split', 'split']] as [key, label] (key)}
            <button class:on={key === ps.view || (ps.view === 'diff' && key === ps.diff.mode)} onclick={() => setView(key)}>{label}</button>
          {/each}
        {/if}
      </span>
    </div>
    <div class="editor" bind:this={editorEl}>
      <div class="code" class:split-mode={m.split} class:plain-mode={m.plain} bind:this={codeEl} style:opacity={enter < 1 || dim > 0 ? (enter * (1 - 0.75 * dim)).toFixed(3) : null} style:transform={enter < 1 ? `translateY(${((1 - enter) * 6).toFixed(2)}px)` : null}>
        {#each v.rows as vr, vi (vr.fold ? 'f' + vr.fold.id : vr.i)}
          {@const label = deco.labels.get(vi)}
          {#if vr.fold}
            {@const fd = vr.fold}
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div class="{v.cls[vi]} {deco.cls[vi]}" data-v={vi} title={t('pane.unfold')} bind:this={rowEls[vi]} onclick={() => openFold(fd.id)}>{@html v.html[vi]}</div>
          {:else}
            <div class="{v.cls[vi]} {deco.cls[vi]}" class:unfold-in={vr.unfolded != null && fresh.folds.has(vr.unfolded)} data-v={vi} style={deco.style[vi]} bind:this={rowEls[vi]}>{@html v.html[vi]}{#if label}<span class="hl-label tone-{label.tone}">{label.text}</span>{/if}</div>
          {/if}
          {#each notes.get(vi) ?? [] as nv (nv.key)}
            <div class="note callout{nv.tone ? ` tone-${nv.tone}` : ''}" style="grid-template-rows:{nv.h.toFixed(3)}fr"><div class="note-clip"><div class="note-in" style:opacity={nv.o.toFixed(3)}>{@html nv.html}</div></div></div>
          {/each}
        {/each}
        <div class="tokline" bind:this={tokEl} hidden></div>
      </div>
    </div>
  {/if}
</div>
