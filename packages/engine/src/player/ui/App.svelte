<script lang="ts">
  // Layout: [explorer] [editor stage] [walkthrough outline] over the playback controls.
  import { splitLines } from '../../shared/diff.ts';
  import { player } from '../app/player.svelte.ts';
  import { ICON, IR, shortRef, T_ } from '../core/env.ts';
  import { scenes } from '../core/timeline.ts';
  import Caption from './Caption.svelte';
  import Controls from './Controls.svelte';
  import Explorer from './Explorer.svelte';
  import Graph from './Graph.svelte';
  import Guide from './Guide.svelte';
  import Help from './Help.svelte';
  import type Pane from './Pane.svelte';
  import Pointer from './Pointer.svelte';
  import Stage from './Stage.svelte';

  const meta = IR.meta || {};
  const src = IR.source || {};
  let panes: Pane[] = $state([]);

  function toggleExplorer() {
    if (matchMedia('(max-width: 1000px)').matches) player.ui.mobileExplorer = !player.ui.mobileExplorer;
    else player.ui.explorer = !player.ui.explorer;
    settle();
  }
  function toggleGuide() { player.ui.guide = !player.ui.guide; settle(); }
  /** Re-measure after a panel slides (overlays placed against the layout follow it). */
  function settle() { player.remeasure(); setTimeout(() => player.remeasure(), 520); }
  function toggleTheme() {
    const r = document.documentElement;
    const cur = r.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    r.dataset.theme = cur === 'light' ? 'dark' : 'light';
    try { localStorage.setItem('wt-theme', r.dataset.theme); } catch { /* storage unavailable */ }
  }

  // ⌘/Ctrl+Click on an identifier: go to its definition (exploration while paused)
  function wordAt(ev: MouseEvent): string | null {
    let node: Node | null = null, off = 0;
    const d = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
    if (d.caretPositionFromPoint) { const c = d.caretPositionFromPoint(ev.clientX, ev.clientY); if (c) { node = c.offsetNode; off = c.offset; } }
    else if (document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(ev.clientX, ev.clientY); if (r) { node = r.startContainer; off = r.startOffset; } }
    if (!node || node.nodeType !== 3) return null;
    const s = node.textContent || '';
    let a = off, b = off;
    while (a > 0 && /[\w$]/.test(s[a - 1])) a--;
    while (b < s.length && /[\w$]/.test(s[b])) b++;
    return s.slice(a, b) || null;
  }
  function findDefinition(word: string): { file: string; line: number } | null {
    const w = word.replace(/[$]/g, '\\$');
    const re = new RegExp(`(?:\\b(?:function|class|def|fn|func|fun|interface|type|struct|enum|trait|const|let|var|val|module|object)\\s+\\*?\\s*${w}\\b)|(?:^\\s*(?:export\\s+)?(?:async\\s+)?${w}\\s*[=:(]\\s*(?:async\\s*)?\\(?)`);
    for (const [p, f] of Object.entries(IR.files)) {
      const text = f.after != null ? f.after : f.before;
      if (!text) continue;
      const lines = splitLines(text);
      for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return { file: p, line: i + 1 };
    }
    return null;
  }
  function onClick(ev: MouseEvent) {
    if (!(ev.metaKey || ev.ctrlKey)) return;
    if (!(ev.target as Element).closest('.row')) return;
    const word = wordAt(ev);
    const def = word ? findDefinition(word) : null;
    if (def) player.exploreOpen(def.file, { line: def.line, side: 'after', view: 'after' });
  }

  function onKey(e: KeyboardEvent) {
    if ((e.target as Element).closest?.('input, select, textarea')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === ' ' || k === 'k' || k === 'K') { e.preventDefault(); player.toggle(); }
    else if (k === 'ArrowRight' && e.shiftKey) player.nextScene();
    else if (k === 'ArrowLeft' && e.shiftKey) player.prevScene();
    else if (k === 'ArrowRight') { e.preventDefault(); player.seek(player.T + 5000, player.playing); }
    else if (k === 'ArrowLeft') { e.preventDefault(); player.seek(player.T - 5000, player.playing); }
    else if (k === ']') player.stepSpeed(1);
    else if (k === '[') player.stepSpeed(-1);
    else if (k === 'p' || k === 'P') player.segPause = !player.segPause;
    else if (k === 'b' || k === 'B') toggleExplorer();
    else if (k === 'g' || k === 'G') toggleGuide();
    else if (k === 'm' || k === 'M') { player.ui.map = !player.ui.map; player.ui.mapExpanded = false; player.commit(); }
    else if (k === '?') player.ui.help = !player.ui.help;
    else if (k === 'Escape') player.ui.help = false;
    else if (/^[1-9]$/.test(k)) { const sc = scenes.findIndex((x) => x.ci === Number(k) - 1); if (sc >= 0) player.gotoScene(sc); }
  }
</script>

<svelte:window onkeydown={onKey} onresize={() => player.remeasure()} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="wt-frame" class:hide-explorer={!player.ui.explorer} class:show-explorer={player.ui.mobileExplorer} class:hide-guide={!player.ui.guide} class:playing={player.playing} class:oriented={player.live} onclick={onClick}>
  <header class="wt-top">
    <button class="icon-btn" title="{T_('탐색기', 'Explorer')} (B)" onclick={toggleExplorer}>{@html ICON.explorer}</button>
    <div class="title">{meta.title || 'Code walkthrough'}</div>
    {#if src.base}<span class="range" title="{src.base} → {src.head}">{shortRef(src.base)} → {src.head === 'WORKTREE' ? T_('작업 트리', 'working tree') : shortRef(src.head)}</span>{/if}
    {#if meta.intent}<span class="badge">{meta.intent}</span>{/if}
    <span class="spacer"></span>
    {#if player.frame.map}<button class="icon-btn" class:on={player.ui.map} title="{T_('구조 지도', 'Structure map')} (M)" onclick={() => { player.ui.map = !player.ui.map; player.ui.mapExpanded = false; player.commit(); }}>{@html ICON.map}</button>{/if}
    <button class="icon-btn" title={T_('테마', 'Theme')} onclick={toggleTheme}>{@html ICON.theme}</button>
    <button class="icon-btn" title="{T_('단축키', 'Shortcuts')} (?)" onclick={() => (player.ui.help = !player.ui.help)}>{@html ICON.help}</button>
    <button class="icon-btn" title="{T_('워크스루 패널', 'Walkthrough panel')} (G)" onclick={toggleGuide}>{@html ICON.guide}</button>
  </header>
  <div class="wt-main">
    <Explorer />
    <Stage bind:panes />
    <Guide />
  </div>
  <Graph />
  <Caption />
  <Pointer {panes} />
  <Controls />
  {#if player.ui.help}<Help />{/if}
</div>
