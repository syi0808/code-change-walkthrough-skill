// Minimal flag parser shared by the CLIs: `--k v`, `--k=v`, boolean flags, and positionals.
export interface Args { _: string[]; [k: string]: string | boolean | string[] | undefined }

export function parseArgs(list: string[], booleans: string[] = [], shorts: Record<string, string> = {}): Args {
  const o: Args = { _: [] };
  for (let i = 0; i < list.length; i++) {
    const x = list[i];
    if (shorts[x]) { o[shorts[x]] = list[++i]; continue; }
    if (!x.startsWith('--')) { o._.push(x); continue; }
    const eq = x.indexOf('=');
    const k = eq < 0 ? x.slice(2) : x.slice(2, eq);
    if (eq >= 0) o[k] = x.slice(eq + 1);
    else if (!booleans.includes(k) && i + 1 < list.length && !list[i + 1].startsWith('-')) o[k] = list[++i];
    else o[k] = true;
  }
  return o;
}

export const str = (v: Args[string]): string | undefined => (typeof v === 'string' ? v : undefined);
