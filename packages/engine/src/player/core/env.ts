// Player environment: the compiled IR, language, and small DOM/text helpers.
import { translator, validateTable } from '../../i18n/index.ts';
import type { Walkthrough } from '../../ir/types.ts';

export const IR: Walkthrough = JSON.parse(document.getElementById('walkthrough-ir')!.textContent || '{}');
// UI strings come from the table the compiler embedded (#walkthrough-i18n), English otherwise.
// They are kept apart from the code so a page can be given another language without a rebuild.
const table = (() => {
  try { return validateTable(JSON.parse(document.getElementById('walkthrough-i18n')?.textContent || 'null')).table; } catch { return null; }
})();
document.documentElement.lang = IR.meta?.language || table?.language || 'en';
/** A UI string by key, with `{name}` placeholders filled in. Plain text: escape it before using it as HTML. */
export const t = translator(table);

export const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));
/** Ease in-out (cubic): movement between two on-screen states. */
export const ease = (p: number): number => (p <= 0 ? 0 : p >= 1 ? 1 : p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
/** Ease out (quint): anything entering or responding. */
export const easeOut = (p: number): number => (p <= 0 ? 0 : p >= 1 ? 1 : 1 - Math.pow(1 - p, 5));
export const esc = (s: unknown): string => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
export const fmt = (ms: number): string => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const clone = <T>(o: T): T => structuredClone(o);
export const shortRef = (r: unknown): string => (/^[0-9a-f]{40}$/i.test(String(r)) ? String(r).slice(0, 10) : String(r));
/** Restart a CSS animation class on a node. */
export const restart = (node: Element, cls: string): void => { node.classList.remove(cls); void (node as HTMLElement).offsetWidth; node.classList.add(cls); };

const mdSpan = (s: string) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
/** Tiny markdown: paragraphs, bullet lists, `code`, **bold**, *italic*. */
export function md(text: string | undefined): string {
  return String(text || '').trim().split(/\n\s*\n/).map((b) => {
    const lines = b.split('\n');
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) return `<ul>${lines.map((l) => `<li>${mdSpan(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`;
    return `<p>${lines.map(mdSpan).join('<br>')}</p>`;
  }).join('');
}
export const mdInline = (t: string | undefined): string => md(t).replace(/^<p>|<\/p>$/g, '');

export const ICON = {
  play: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l9.5-5.5z"/></svg>',
  pause: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3.5 2h3v12h-3zM9.5 2h3v12h-3z"/></svg>',
  prev: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 2h2v12H3zM14 2.5v11L6 8z"/></svg>',
  next: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M11 2h2v12h-2zM2 2.5v11L10 8z"/></svg>',
  restart: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2.5 8a5.5 5.5 0 1 0 1.7-4"/><path d="M2 2.5v3h3"/></svg>',
  explorer: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 3.5h4l1.2 1.5H14v7.5H2z"/></svg>',
  guide: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M5 4h8M5 8h8M5 12h8"/><circle cx="2.5" cy="4" r=".8" fill="currentColor"/><circle cx="2.5" cy="8" r=".8" fill="currentColor"/><circle cx="2.5" cy="12" r=".8" fill="currentColor"/></svg>',
  theme: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="5.5"/><path d="M8 2.5a5.5 5.5 0 0 0 0 11z" fill="currentColor"/></svg>',
  help: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6"/><path d="M6.2 6.3a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4"/><circle cx="8" cy="11.6" r=".4" fill="currentColor"/></svg>',
  close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  chevron: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 4l4 4-4 4"/></svg>',
  unfold: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8 2v4M6 4l2-2 2 2M8 14v-4M6 12l2 2 2-2M3 8h10"/></svg>',
  filter: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 3h12L9.5 8.5V13l-3-1.5v-3z"/></svg>',
  collapse: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M5.5 8h5"/></svg>',
  check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3.5 8.5l3 3 6-7"/></svg>',
  map: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="5" width="4" height="3" rx=".6"/><rect x="10.5" y="2" width="4" height="3" rx=".6"/><rect x="10.5" y="9" width="4" height="3" rx=".6"/><path d="M5.5 6.5h2.5V3.5h2.5M8 6.5v4h2.5"/></svg>',
  expand: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5L9 7M2.5 13.5L7 9"/></svg>',
  shrink: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13.5 6.5h-4v-4M2.5 9.5h4v4M9.5 6.5L14 2M6.5 9.5L2 14"/></svg>',
  pointer: '<svg viewBox="0 0 22 22"><path d="M4 2l13 9.5-5.6 1 3.2 6.3-2.4 1.2-3.2-6.3L4.6 17.5z" fill="#fff" stroke="#111" stroke-width="1.2" stroke-linejoin="round"/></svg>',
};

export const STATUS_LETTER: Record<string, string> = { added: 'A', deleted: 'D', modified: 'M', renamed: 'R', copied: 'C' };
// VS Code-like file icon glyphs (label + colour class) by extension
const FILE_ICON: Record<string, [string, string]> = { ts: ['TS', 'i-blue'], tsx: ['TSX', 'i-blue'], mts: ['TS', 'i-blue'], cts: ['TS', 'i-blue'], js: ['JS', 'i-yellow'], jsx: ['JSX', 'i-yellow'], mjs: ['JS', 'i-yellow'], cjs: ['JS', 'i-yellow'], json: ['{}', 'i-yellow'], md: ['M↓', 'i-blue'], py: ['PY', 'i-blue'], go: ['GO', 'i-cyan'], rs: ['RS', 'i-orange'], java: ['J', 'i-red'], kt: ['K', 'i-purple'], rb: ['RB', 'i-red'], php: ['PHP', 'i-purple'], css: ['#', 'i-blue'], scss: ['#', 'i-pink'], html: ['<>', 'i-orange'], vue: ['V', 'i-green'], svelte: ['S', 'i-orange'], yml: ['Y', 'i-purple'], yaml: ['Y', 'i-purple'], toml: ['T', 'i-gray'], sql: ['DB', 'i-orange'], sh: ['$', 'i-green'], swift: ['SW', 'i-orange'], c: ['C', 'i-blue'], h: ['H', 'i-purple'], cpp: ['C++', 'i-blue'], cs: ['C#', 'i-green'], dart: ['DA', 'i-cyan'], lock: ['🔒', 'i-gray'], graphql: ['GQ', 'i-pink'], proto: ['PB', 'i-gray'], txt: ['≡', 'i-gray'], env: ['⚙', 'i-gray'] };
export function fileIcon(name: string): [string, string] {
  const lower = name.toLowerCase();
  if (lower === 'dockerfile') return ['🐳', 'i-blue'];
  if (lower.startsWith('.env')) return FILE_ICON.env;
  if (/\.(spec|test)\.[a-z]+$/.test(lower)) return ['✓', 'i-green'];
  const ext = lower.includes('.') ? lower.split('.').pop()! : '';
  return FILE_ICON[ext] || ['•', 'i-gray'];
}
export const baseName = (p: string): string => p.split('/').pop() || p;
