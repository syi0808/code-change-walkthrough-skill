// UI strings by key. The English table is built in; a table for another language is a
// JSON file `{ "language": "ko", "strings": { key: text } }` (see i18n/ at the repository
// root). The compiler uses it for the names it generates and embeds it in the page; the
// player reads it from there. A missing key falls back to English, so a partial table works.
import { EN, type Key } from './en.ts';

export { EN, type Key };
export type Strings = Partial<Record<Key, string>>;
export interface Table { language: string; strings: Strings }
export type Translate = (key: Key, vars?: Record<string, string | number>) => string;

/** Where published tables live: `<base>/<lang>.json`. */
export const TABLE_BASE = 'https://raw.githubusercontent.com/syi0808/code-change-walkthrough-skill/main/i18n';
const MAX_LEN = 400;

const holes = (s: string) => (s.match(/\{\w+\}/g) || []).sort().join(',');

/** Check a table read from disk or the network: keep known keys with string values and the same placeholders. */
export function validateTable(x: unknown): { table: Table | null; problems: string[] } {
  const problems: string[] = [];
  if (!x || typeof x !== 'object' || Array.isArray(x)) return { table: null, problems: ['not a JSON object'] };
  const o = x as { language?: unknown; strings?: unknown };
  if (typeof o.language !== 'string' || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(o.language)) problems.push('"language" must be a language tag such as "ko" or "pt-BR"');
  if (!o.strings || typeof o.strings !== 'object' || Array.isArray(o.strings)) return { table: null, problems: [...problems, '"strings" must be an object'] };
  const strings: Strings = {};
  for (const [k, v] of Object.entries(o.strings as Record<string, unknown>)) {
    if (!(k in EN)) { problems.push(`unknown key "${k}" (ignored)`); continue; }
    if (typeof v !== 'string' || !v.trim() || v.length > MAX_LEN) { problems.push(`"${k}" must be a non-empty string of at most ${MAX_LEN} characters (ignored)`); continue; }
    if (holes(v) !== holes(EN[k as Key])) { problems.push(`"${k}" must keep the placeholders ${holes(EN[k as Key]) || '(none)'} (ignored)`); continue; }
    strings[k as Key] = v;
  }
  const missing = (Object.keys(EN) as Key[]).filter((k) => !strings[k]);
  if (missing.length) problems.push(`${missing.length} key(s) missing, shown in English: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ', …' : ''}`);
  return { table: typeof o.language === 'string' ? { language: o.language, strings } : null, problems };
}

/** A lookup function over a table (English for anything it does not have). */
export function translator(table?: Table | null): Translate {
  const s = table?.strings || {};
  return (key, vars) => {
    const text = s[key] ?? EN[key] ?? key;
    return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] != null ? String(vars[k]) : m)) : text;
  };
}

/** Language tags to try for a walkthrough language, most specific first: "pt-BR" -> ["pt-BR", "pt"]. */
export function candidates(lang: string): string[] {
  const parts = String(lang || '').trim().split(/[-_]/).filter(Boolean);
  const out: string[] = [];
  for (let i = parts.length; i >= 1; i--) out.push(parts.slice(0, i).map((p, j) => (j === 0 ? p.toLowerCase() : p)).join('-'));
  return out;
}

/** The English table as a file, for translating into a new language. */
export const englishTable = (): Table => ({ language: 'en', strings: { ...EN } });
