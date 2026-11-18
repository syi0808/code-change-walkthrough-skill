// Player entry: mounts the app on the compiled IR embedded in the page.
import './styles/index.css';
import { mount } from 'svelte';
import { player } from './app/player.svelte.ts';
import { stateAt } from './core/state.ts';
import { scenes, total } from './core/timeline.ts';
import App from './ui/App.svelte';

try { const th = localStorage.getItem('wt-theme'); if (th) document.documentElement.dataset.theme = th; } catch { /* storage unavailable */ }

const target = document.getElementById('app')!;
mount(App, { target });

// reopen at a scene (#scene=<id or number>), e.g. after a live reload
const hash = /scene=([^&]+)/.exec(location.hash);
if (hash) {
  const v = decodeURIComponent(hash[1]);
  const i = scenes.findIndex((x, n) => x.id === v || String(n + 1) === v);
  if (i >= 0) { player.started = true; player.T = scenes[i].t0 + 1; }
}
target.removeAttribute('aria-busy');
player.commit();

declare global { interface Window { __walkthrough: unknown } }
window.__walkthrough = {
  scenes, total, stateAt,
  seek: (t: number) => player.seek(t),
  play: () => player.play(),
  pause: () => player.pause(),
  get T() { return player.T; },
};
