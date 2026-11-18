// The voice (one explanation at a time) as HTML: a tag for notes, progress dots for narration items.
import { esc, mdInline, T_ } from '../core/env.ts';
import type { Voice } from '../core/voice.ts';

const TAGS: Record<string, [string, string]> = { info: ['메모', 'note'], why: ['왜', 'why'], risk: ['주의', 'risk'], tip: ['팁', 'tip'] };

export function voiceHtml(v: Voice): string {
  const tag = v.kind === 'note'
    ? `<span class="tag">${esc(TAGS[v.tone || 'info'] ? T_(...TAGS[v.tone || 'info']) : v.tone)}</span>`
    : `<span class="cap-dots">${Array.from({ length: v.n }, (_, i) => `<i class="${i < v.k ? 'past' : i === v.k ? 'cur' : ''}"></i>`).join('')}</span>`;
  return `${tag}<span class="cap-text">${mdInline(v.text)}</span>`;
}
