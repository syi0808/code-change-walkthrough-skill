// Tiny language-agnostic syntax highlighter (offline, no dependencies): comments,
// strings, numbers, a union keyword set, types (Capitalised identifiers) and calls.

const KW = new Set(('abstract and as assert async await break case catch class const continue def default defer del delete do elif else enum export extends extern false final finally fn for from func function go goto if impl implements import in instanceof interface is lambda let loop match mod module mut namespace new nil none None not null object of or override package private protected pub public raise readonly record return self Self static struct super switch this throw throws trait true True False try type typeof union unsafe use using val var void when where while with yield end then begin rescue ensure unless until require module defp defmodule select chan map range fallthrough suspend fun companion data sealed open internal lateinit init get set let var guard protocol extension inout fileprivate typealias associatedtype dyn crate ref move where').split(' '));
const LINE_COMMENT: Record<string, string> = { python: '#', ruby: '#', shell: '#', yaml: '#', toml: '#', r: '#', elixir: '#', perl: '#', makefile: '#', dockerfile: '#', hcl: '#', sql: '--', lua: '--', haskell: '--' };
const NO_HL = new Set(['markdown', 'text']);

export interface HlState { block?: string; blockCls?: string }

export const escText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Highlight one line. `st` carries multi-line comment / string state. */
export function highlightLine(text: string, lang: string | undefined, st: HlState = {}): { html: string; st: HlState } {
  const L = lang || 'text';
  if (NO_HL.has(L)) return { html: escText(text), st };
  const lc = LINE_COMMENT[L] || '//';
  const hashToo = lc === '//' && L === 'php';
  const blockC = !LINE_COMMENT[L] || L === 'sql' || L === 'hcl';
  let out = '';
  let i = 0;
  const n = text.length;
  const span = (cls: string, s: string) => { out += `<span class="tk-${cls}">${escText(s)}</span>`; };
  if (st.block) {
    const end = text.indexOf(st.block);
    if (end < 0) { span(st.blockCls || 'com', text); return { html: out, st }; }
    span(st.blockCls || 'com', text.slice(0, end + st.block.length));
    i = end + st.block.length;
    st = {};
  }
  while (i < n) {
    const c = text[i];
    const rest = text.slice(i);
    if (rest.startsWith(lc) || (hashToo && c === '#')) { span('com', rest); break; }
    if (blockC && rest.startsWith('/*')) {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) { span('com', rest); st = { block: '*/', blockCls: 'com' }; break; }
      span('com', text.slice(i, end + 2)); i = end + 2; continue;
    }
    if (L === 'python' && (rest.startsWith('"""') || rest.startsWith("'''"))) {
      const q = rest.slice(0, 3);
      const end = text.indexOf(q, i + 3);
      if (end < 0) { span('str', rest); st = { block: q, blockCls: 'str' }; break; }
      span('str', text.slice(i, end + 3)); i = end + 3; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const life = c === "'" && (L === 'rust' || L === 'ocaml') ? /^'[a-z_]\w*(?!')/.exec(rest) : null;
      if (life) { span('kw', life[0]); i += life[0].length; continue; }
      let j = i + 1;
      while (j < n && text[j] !== c) { if (text[j] === '\\') j++; j++; }
      if (c === '`' && j >= n) { span('str', rest); st = { block: '`', blockCls: 'str' }; break; }
      span('str', text.slice(i, Math.min(n, j + 1))); i = j + 1; continue;
    }
    if (/[0-9]/.test(c) && !/[\w$]/.test(text[i - 1] || '')) {
      const m = /^(0x[0-9a-fA-F_]+|\d[\d_]*(\.\d+)?([eE][+-]?\d+)?[a-zA-Z]*)/.exec(rest)!;
      span('num', m[0]); i += m[0].length; continue;
    }
    if (/[A-Za-z_$@]/.test(c)) {
      const m = /^[@$]?[A-Za-z_$][\w$]*[?!]?/.exec(rest);
      const w = m ? m[0] : c;
      const call = /^\s*(\(|<[\w\s,]*>\s*\()/.test(text.slice(i + w.length));
      if (KW.has(w)) span('kw', w);
      else if (c === '@') span('meta', w);
      else if (call) span('fn', w);
      else if (/^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/.test(w)) span('type', w);
      else if (/^[A-Z][A-Z0-9_]+$/.test(w) && w.length > 1) span('const', w);
      else out += escText(w);
      i += w.length; continue;
    }
    if (/[{}()[\];,.:=<>+\-*/%!&|^~?]/.test(c)) { span('p', c); i++; continue; }
    out += escText(c); i++;
  }
  return { html: out, st };
}

/** Highlight a whole file into html lines. */
export function highlightFile(lines: string[], lang: string | undefined): string[] {
  let st: HlState = {};
  return lines.map((l) => { const r = highlightLine(l, lang, st); st = r.st; return r.html; });
}
