// The voice (one explanation at a time) as HTML: a tag for notes; narration items are plain text.
import type { Key } from '../../i18n/index.ts';
import { esc, mdInline, t } from '../core/env.ts';
import type { Voice } from '../core/voice.ts';

const TAGS: Record<string, Key> = { info: 'note.info', why: 'note.why', risk: 'note.risk', tip: 'note.tip' };

export function voiceHtml(v: Voice): string {
  const tag = v.kind === 'note' ? `<span class="tag">${esc(TAGS[v.tone || 'info'] ? t(TAGS[v.tone || 'info']) : v.tone)}</span>` : '';
  return `${tag}<span class="cap-text">${mdInline(v.text)}</span>`;
}
