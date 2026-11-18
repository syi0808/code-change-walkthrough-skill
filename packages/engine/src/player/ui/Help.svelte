<script lang="ts">
  import { player } from '../app/player.svelte.ts';
  import { esc, t } from '../core/env.ts';
  const rows: [string, string][] = [
    ['<kbd>Space</kbd> / <kbd>K</kbd>', t('help.play')],
    ['<kbd>←</kbd> <kbd>→</kbd>', t('help.seek')],
    ['<kbd>⇧</kbd>+<kbd>←</kbd> <kbd>→</kbd>', t('help.scene')],
    ['<kbd>[</kbd> <kbd>]</kbd>', t('help.speed')],
    ['<kbd>P</kbd>', t('help.segPause')],
    ['<kbd>1</kbd>–<kbd>9</kbd>', t('help.chapter')],
    ['<kbd>B</kbd> / <kbd>G</kbd> / <kbd>M</kbd>', t('help.panels')],
    [`⌘/Ctrl + ${esc(t('pointer.click'))}`, t('help.definition')],
  ];
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="help" onclick={(e) => { if (e.target === e.currentTarget) player.ui.help = false; }}>
  <div role="dialog" aria-label="shortcuts"><h2>{t('help.title')}</h2>
    <table><tbody>{#each rows as [k, d] (k)}<tr><td>{@html k}</td><td>{d}</td></tr>{/each}</tbody></table>
  </div>
</div>
