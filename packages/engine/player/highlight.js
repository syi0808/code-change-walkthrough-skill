/* Tiny language-agnostic syntax highlighter (offline, no dependencies).
 * Recognises comments, strings, numbers, a union keyword set, types
 * (Capitalised identifiers) and call sites. Exposes globalThis.WalkHL. */
(function (root) {
  'use strict';
  const KW = new Set(('abstract and as assert async await break case catch class const continue def default defer del delete do elif else enum export extends extern false final finally fn for from func function go goto if impl implements import in instanceof interface is lambda let loop match mod module mut namespace new nil none None not null object of or override package private protected pub public raise readonly record return self Self static struct super switch this throw throws trait true True False try type typeof union unsafe use using val var void when where while with yield end then begin rescue ensure unless until require module defp defmodule select chan map range fallthrough suspend fun companion data sealed open internal lateinit init get set let var guard protocol extension inout fileprivate typealias associatedtype dyn crate ref move where').split(' '));
  const LINE_COMMENT = { python: '#', ruby: '#', shell: '#', yaml: '#', toml: '#', r: '#', elixir: '#', perl: '#', makefile: '#', dockerfile: '#', hcl: '#', sql: '--', lua: '--', haskell: '--' };
  const NO_HL = new Set(['markdown', 'text']);

  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /** Highlight one line. `st` carries multi-line comment / string state. */
  function line(text, lang, st) {
    st = st || {};
    if (NO_HL.has(lang)) return { html: esc(text), st };
    const lc = LINE_COMMENT[lang] || '//';
    const hashToo = lc === '//' && (lang === 'php');
    const blockC = !LINE_COMMENT[lang] || lang === 'sql' || lang === 'hcl';
    let out = '';
    let i = 0;
    const n = text.length;
    const span = (cls, s) => { out += `<span class="tk-${cls}">${esc(s)}</span>`; };
    if (st.block) {
      const end = text.indexOf(st.block);
      if (end < 0) { span(st.blockCls, text); return { html: out, st }; }
      span(st.blockCls, text.slice(0, end + st.block.length));
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
      if ((lang === 'python') && (rest.startsWith('"""') || rest.startsWith("'''"))) {
        const q = rest.slice(0, 3);
        const end = text.indexOf(q, i + 3);
        if (end < 0) { span('str', rest); st = { block: q, blockCls: 'str' }; break; }
        span('str', text.slice(i, end + 3)); i = end + 3; continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        if (c === "'" && (lang === 'rust' || lang === 'ocaml') && /^'[a-z_]\w*(?!')/.test(rest)) { span('kw', rest.match(/^'[a-z_]\w*/)[0]); i += rest.match(/^'[a-z_]\w*/)[0].length; continue; }
        let j = i + 1;
        while (j < n && text[j] !== c) { if (text[j] === '\\') j++; j++; }
        if (c === '`' && j >= n) { span('str', rest); st = { block: '`', blockCls: 'str' }; break; }
        span('str', text.slice(i, Math.min(n, j + 1))); i = j + 1; continue;
      }
      if (/[0-9]/.test(c) && !/[\w$]/.test(text[i - 1] || '')) {
        const m = rest.match(/^(0x[0-9a-fA-F_]+|\d[\d_]*(\.\d+)?([eE][+-]?\d+)?[a-zA-Z]*)/);
        span('num', m[0]); i += m[0].length; continue;
      }
      if (/[A-Za-z_$@]/.test(c)) {
        const m = rest.match(/^[@$]?[A-Za-z_$][\w$]*[?!]?/);
        const w = m[0];
        const next = text.slice(i + w.length).match(/^\s*(\(|<[\w\s,]*>\s*\()/);
        if (KW.has(w)) span('kw', w);
        else if (c === '@') span('meta', w);
        else if (next) span('fn', w);
        else if (/^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$/.test(w)) span('type', w);
        else if (/^[A-Z][A-Z0-9_]+$/.test(w) && w.length > 1) span('const', w);
        else out += esc(w);
        i += w.length; continue;
      }
      if (/[{}()[\];,.:=<>+\-*/%!&|^~?]/.test(c)) { span('p', c); i++; continue; }
      out += esc(c); i++;
    }
    return { html: out, st };
  }

  /** Highlight a whole file → array of html lines. */
  function file(lines, lang) {
    let st = {};
    return lines.map((l) => { const r = line(l, lang, st); st = r.st; return r.html; });
  }

  root.WalkHL = { line, file, esc };
})(typeof globalThis !== 'undefined' ? globalThis : this);
