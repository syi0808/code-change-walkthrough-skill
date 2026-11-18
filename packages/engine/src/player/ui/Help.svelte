<script lang="ts">
  import { player } from '../app/player.svelte.ts';
  import { T_ } from '../core/env.ts';
  const rows: [string, string][] = [
    ['<kbd>Space</kbd> / <kbd>K</kbd>', T_('재생 / 일시정지', 'Play / pause')],
    ['<kbd>←</kbd> <kbd>→</kbd>', T_('5초 뒤로 / 앞으로', 'Seek ±5s')],
    ['<kbd>⇧</kbd>+<kbd>←</kbd> <kbd>→</kbd>', T_('이전 / 다음 장면', 'Previous / next scene')],
    ['<kbd>[</kbd> <kbd>]</kbd>', T_('배속 낮추기 / 높이기', 'Slower / faster')],
    ['<kbd>P</kbd>', T_('장면마다 멈춤 켜기/끄기', 'Toggle pause per scene')],
    ['<kbd>1</kbd>–<kbd>9</kbd>', T_('N번째 챕터로 이동', 'Jump to chapter N')],
    ['<kbd>B</kbd> / <kbd>G</kbd> / <kbd>M</kbd>', T_('탐색기 / 워크스루 패널 / 구조 지도', 'Explorer / walkthrough panel / structure map')],
    [`⌘/Ctrl + ${T_('클릭', 'Click')}`, T_('식별자의 정의로 이동 (일시정지 중)', 'Go to definition (while paused)')],
  ];
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="help" onclick={(e) => { if (e.target === e.currentTarget) player.ui.help = false; }}>
  <div role="dialog" aria-label="shortcuts"><h2>{T_('단축키', 'Keyboard shortcuts')}</h2>
    <table><tbody>{#each rows as [k, d] (k)}<tr><td>{@html k}</td><td>{d}</td></tr>{/each}</tbody></table>
  </div>
</div>
