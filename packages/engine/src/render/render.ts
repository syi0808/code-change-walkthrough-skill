// Compiled IR -> one standalone HTML file: player, styles and data inlined, no external requests.
import { css, js, template } from 'virtual:player';
import type { Table } from '../i18n/index.ts';
import type { Walkthrough } from '../ir/types.ts';

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** JSON that is safe inside a <script> element. */
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => (c === '\u2028' ? '\\u2028' : '\\u2029'));

/** `i18n` is the UI string table for the page (none: English). It goes in its own element so it can be swapped later. */
export function render(ir: Walkthrough, { inject = '', i18n = null }: { inject?: string; i18n?: Table | null } = {}): string {
  const parts: Record<string, string> = {
    TITLE: escapeHtml(ir.meta?.title || 'Code walkthrough'),
    CSS: css,
    JS: js.replace(/<\/script/gi, '<\\/script'),
    IR: scriptJson(ir),
    I18N: scriptJson(i18n),
  };
  // one pass over the template only: inserted content is never scanned for placeholders
  const html = template.replace(/\{\{(TITLE|CSS|JS|IR|I18N)\}\}/g, (_, k: string) => parts[k]);
  const end = html.lastIndexOf('</body>');
  return inject && end >= 0 ? html.slice(0, end) + inject + html.slice(end) : html;
}
