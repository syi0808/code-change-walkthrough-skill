<script lang="ts">
  // The simulated mouse pointer: moves along a gentle arc between anchors (explorer rows,
  // tabs, reference entries, code tokens), measured after everything else has moved.
  import { onDestroy } from 'svelte';
  import { ORDER, player } from '../app/player.svelte.ts';
  import { clamp, ICON, T_ } from '../core/env.ts';
  import type { Anchor } from '../core/state.ts';
  import type Pane from './Pane.svelte';

  let { panes }: { panes: Pane[] } = $props();

  let ptr: HTMLDivElement | undefined = $state();
  let keys: HTMLDivElement | undefined = $state();
  const s = $derived(player.frame);

  type Pt = { x: number; y: number };
  const within = (pt: Pt, box: DOMRect | null): Pt => (box ? { x: clamp(pt.x, box.left + 4, box.right - 8), y: clamp(pt.y, box.top + 4, box.bottom - 10) } : pt);
  const visible = (r: DOMRect, box: DOMRect) => r.bottom > box.top + 2 && r.top < box.bottom - 2 && r.right > box.left && r.left < box.right;

  function pos(a: Anchor | null): Pt | null {
    if (!a) {
      const st = document.querySelector('.wt-stage')!.getBoundingClientRect();
      return { x: st.left + st.width * 0.62, y: st.top + st.height * 0.88 };
    }
    if (a.kind === 'ex') {
      const row = document.querySelector<HTMLElement>(`.ex-row[data-file="${CSS.escape(a.path)}"]`);
      const box = document.querySelector('.ex-body')?.getBoundingClientRect();
      if (!row || !box || !box.width) return null;
      const r = row.getBoundingClientRect();
      if (!visible(r, box)) return within({ x: r.left + 60, y: r.top + r.height * 0.6 }, box);
      const nm = row.querySelector('.nm')!.getBoundingClientRect();
      return { x: nm.left + Math.min(nm.width, 80) * 0.5, y: r.top + r.height * 0.62 };
    }
    if (a.kind === 'tab') {
      const b = panes[a.pane]?.tabBox(a.file);
      return b ? within({ x: b.tab.left + b.tab.width * 0.5, y: b.tab.top + b.tab.height * 0.6 }, b.strip) : null;
    }
    if (a.kind === 'ref') {
      const li = document.querySelectorAll('.wt-refs li')[a.index];
      if (!li) return null;
      const r = li.getBoundingClientRect();
      return within({ x: r.left + 90, y: r.top + r.height * 0.6 }, document.querySelector('.wt-refs ol')?.getBoundingClientRect() ?? null);
    }
    const r = panes[a.pane]?.tokenRect(a.side, a.line, a.token);
    return r ? within({ x: r.abs.left + Math.min(r.abs.width, 60) / 2, y: r.abs.top + r.abs.height * 0.7 }, panes[a.pane].editorBox()) : null;
  }

  const off = player.layout(ORDER.pointer, () => {
    if (!ptr || !keys) return;
    const p = s.pointer;
    const to = p ? pos(p.to) : null;
    if (!p || !to) { ptr.hidden = true; keys.hidden = true; return; }
    const from = pos(p.from) || pos(null)!;
    // natural motion: slow-in / slow-out along a gentle arc
    const dx = to.x - from.x, dy = to.y - from.y, dist = Math.hypot(dx, dy) || 1;
    const bow = Math.sin(Math.PI * p.p) * Math.min(80, dist * 0.12);
    const x = from.x + dx * p.p + (-dy / dist) * bow, y = from.y + dy * p.p + (dx / dist) * bow;
    ptr.hidden = false;
    ptr.style.transform = `translate(${x - 4}px, ${y - 2}px)`;
    ptr.style.opacity = p.fade ? '0' : '1';
    ptr.classList.toggle('click', !!p.click);
    keys.hidden = !s.keys;
    if (s.keys) Object.assign(keys.style, { left: `${x}px`, top: `${y}px` });
  });
  onDestroy(off);
</script>

<div class="wt-pointer" bind:this={ptr} hidden>{@html ICON.pointer}<span class="ripple"></span></div>
<div class="wt-keys" bind:this={keys} hidden>{#each s.keys || [] as k (k)}<kbd>{k}</kbd>{/each}<kbd>{T_('클릭', 'Click')}</kbd></div>
