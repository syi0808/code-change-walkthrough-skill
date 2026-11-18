// UI string tables on disk: where the engine looks for one, and the one-time download.
// A table installed for a language lives in `<engine script dir>/../i18n/<lang>.json`,
// which for the skill is `<skill>/i18n/<lang>.json`. Compiling never touches the network.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidates, englishTable, TABLE_BASE, validateTable, type Table } from '../i18n/index.ts';

export const I18N_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'i18n');

export interface Loaded { table: Table | null; file: string | null; problems: string[] }

function readTable(file: string): Loaded {
  let raw: unknown;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { table: null, file, problems: [`cannot read ${file}: ${(e as Error).message}`] }; }
  const { table, problems } = validateTable(raw);
  return { table, file, problems };
}

const isEnglish = (lang: string) => /^en\b/i.test(lang);

/** The table for an IR file: `--i18n FILE` if given, else the installed table for `meta.language`. */
export function tableFor(irFile: string, explicit?: string, dir = I18N_DIR): Loaded {
  if (explicit) return readTable(path.resolve(explicit));
  if (!/\.json$/i.test(irFile)) return { table: null, file: null, problems: [] };
  let lang = 'en';
  try { lang = (JSON.parse(fs.readFileSync(irFile, 'utf8')) as { meta?: { language?: string } }).meta?.language || 'en'; } catch { /* reported by compile */ }
  if (isEnglish(lang)) return { table: null, file: null, problems: [] };
  for (const c of candidates(lang)) {
    const f = path.join(dir, `${c}.json`);
    if (fs.existsSync(f)) return readTable(f);
  }
  return { table: null, file: null, problems: [] };
}

export interface InstallResult { status: 'installed' | 'present' | 'builtin' | 'missing'; file: string | null; lang: string; problems: string[]; tried: string[] }

/** Make sure a table for `lang` is installed: download it from the published tables once. */
export async function install(lang: string, o: { dir?: string; from?: string; force?: boolean } = {}): Promise<InstallResult> {
  const dir = o.dir ? path.resolve(o.dir) : I18N_DIR;
  const tags = candidates(lang);
  if (!tags.length) throw new Error('give a language tag, e.g. "ko" or "pt-BR"');
  if (isEnglish(tags[0])) return { status: 'builtin', file: null, lang: 'en', problems: [], tried: [] };
  if (!o.force) for (const c of tags) {
    const f = path.join(dir, `${c}.json`);
    if (fs.existsSync(f)) return { status: 'present', file: f, lang: c, problems: readTable(f).problems, tried: [] };
  }
  const base = (o.from || TABLE_BASE).replace(/\/+$/, '');
  const tried: string[] = [];
  for (const c of tags) {
    const url = `${base}/${encodeURIComponent(c)}.json`;
    tried.push(url);
    let res: Response;
    try { res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) }); }
    catch (e) { throw new Error(`cannot reach ${url}: ${(e as Error).message}`); }
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const text = await res.text();
    if (text.length > 200_000) throw new Error(`${url}: unexpectedly large (${text.length} bytes)`);
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new Error(`${url}: not JSON`); }
    const { table, problems } = validateTable(raw);
    if (!table) throw new Error(`${url}: not a string table (${problems.join('; ')})`);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${c}.json`);
    // write only what was validated: known keys, plain strings
    fs.writeFileSync(file, JSON.stringify(table, null, 2) + '\n');
    return { status: 'installed', file, lang: c, problems, tried };
  }
  return { status: 'missing', file: path.join(dir, `${tags[tags.length - 1]}.json`), lang: tags[tags.length - 1], problems: [], tried };
}

export const template = (): string => JSON.stringify(englishTable(), null, 2) + '\n';
