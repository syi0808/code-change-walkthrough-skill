// Language-agnostic, heuristic code structure extraction.
// No parsers, no per-framework logic: a union of regex patterns that covers the
// definition / import idioms of mainstream languages. Precision is "good enough
// to plan an explanation"; the LLM verifies anything it relies on by reading code.
import path from 'node:path';

const EXT_LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  vue: 'vue', svelte: 'svelte', py: 'python', pyi: 'python', rb: 'ruby', go: 'go',
  rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin', scala: 'scala', swift: 'swift',
  cs: 'csharp', fs: 'fsharp', php: 'php', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp',
  hpp: 'cpp', hh: 'cpp', m: 'objc', mm: 'objc', dart: 'dart', ex: 'elixir', exs: 'elixir',
  erl: 'erlang', hs: 'haskell', lua: 'lua', r: 'r', jl: 'julia', sh: 'shell', bash: 'shell',
  zsh: 'shell', sql: 'sql', graphql: 'graphql', gql: 'graphql', proto: 'protobuf',
  css: 'css', scss: 'css', less: 'css', html: 'html', xml: 'xml', json: 'json', yaml: 'yaml',
  yml: 'yaml', toml: 'toml', md: 'markdown', tf: 'hcl', hcl: 'hcl', gradle: 'groovy', groovy: 'groovy',
};

export const INDENT_LANGS = new Set(['python', 'yaml', 'haskell', 'fsharp']);

export function detectLanguage(file) {
  const base = path.basename(file).toLowerCase();
  if (base === 'dockerfile') return 'dockerfile';
  if (base === 'makefile') return 'makefile';
  const ext = base.includes('.') ? base.split('.').pop() : '';
  return EXT_LANG[ext] || 'text';
}

export function isTestFile(file) {
  return /(^|\/)(__tests__|tests?|spec|specs|e2e)(\/|$)/i.test(file)
    || /[._-](test|spec)\.[a-z0-9]+$/i.test(file)
    || /(^|\/)test_[^/]+\.py$/.test(file)
    || /_test\.(go|py|rb|exs?)$/.test(file);
}

export function isGeneratedFile(file) {
  return /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock|bun\.lockb?)$/.test(file)
    || /(^|\/)(dist|build|out|vendor|node_modules|\.next|coverage|__snapshots__)\//.test(file)
    || /\.(min\.(js|css)|map|snap|pb\.go|g\.dart|generated\.\w+)$/.test(file)
    || /(_pb2(_grpc)?\.py|\.d\.ts)$/.test(file);
}

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'else', 'do', 'try',
  'new', 'await', 'typeof', 'sizeof', 'elif', 'with', 'match', 'case', 'when', 'select', 'super', 'this', 'self', 'constructor']);

const JS = ['javascript', 'typescript', 'vue', 'svelte'];
const C_LIKE = ['c', 'cpp', 'objc'];
const JVM_ETC = ['java', 'csharp', 'groovy', 'dart', 'scala'];
// Each pattern: [kind, regex, languages|null]. `null` = any language.
// The named group `n` is the symbol name. Patterns are scoped to languages so
// that e.g. a Python call line is never mistaken for a C function definition.
const DEF_PATTERNS = [
  ['function', /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(?<n>[A-Za-z_$][\w$]*)/, [...JS, 'php']],
  ['class', /^\s*(?:export\s+)?(?:default\s+)?(?:public\s+|private\s+|protected\s+|internal\s+|abstract\s+|final\s+|sealed\s+|open\s+|data\s+|static\s+|partial\s+)*(?:class|interface|trait|struct|enum|record|protocol|object|module|union)\s+(?<n>[A-Za-z_$][\w$]*)/, null],
  ['type', /^\s*(?:export\s+)?(?:declare\s+)?type\s+(?<n>[A-Za-z_$][\w$]*)\s*(?:<[^=]*>)?\s*=/, [...JS, 'scala', 'swift']],
  ['function', /^\s*(?:export\s+)?(?:const|let|var)\s+(?<n>[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/, JS],
  ['function', /^\s*(?:export\s+)?(?:const|let|var)\s+(?<n>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\b/, JS],
  ['function', /^\s*(?:async\s+)?def\s+(?:self\.)?(?<n>[A-Za-z_]\w*[?!]?)/, ['python', 'ruby', 'scala', 'groovy', 'julia']],
  ['function', /^\s*(?:(?:public|private|fileprivate|internal|open|static|override|mutating|@\w+)\s+)*func\s+(?:\([^)]*\)\s*)?(?<n>[A-Za-z_]\w*)/, ['go', 'swift']],
  ['type', /^\s*type\s+(?<n>[A-Z]\w*)\s+(?:struct|interface|func|\w)/, ['go']],
  ['function', /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+(?<n>[A-Za-z_]\w*)/, ['rust']],
  ['class', /^\s*impl(?:<[^>]*>)?\s+(?:[\w:<>]+\s+for\s+)?(?<n>[A-Za-z_]\w*)/, ['rust']],
  ['function', /^\s*(?:(?:public|private|protected|internal|override|open|suspend|inline|operator|infix|tailrec|abstract|final)\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.]+\.)?(?<n>[A-Za-z_]\w*)/, ['kotlin']],
  ['function', /^\s*(?:(?:public|private|protected|static|final|abstract|synchronized|native|virtual|override|async|internal|extern|sealed|unsafe|partial|default)\s+)+[\w<>\[\],.?\s]*?\s(?<n>[A-Za-z_]\w*)\s*\([^;]*$/, [...JVM_ETC, 'cpp', 'objc', 'php']],
  ['function', /^\s*(?:(?:public|private|protected|static|async|readonly|override|abstract|get|set)\s+)*(?<n>[A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::\s*[^={]+)?\{\s*$/, [...JS, ...C_LIKE, ...JVM_ETC, 'php', 'shell']],
  ['function', /^(?:[\w*&:<>,\s]+?)\s\**(?<n>[A-Za-z_]\w*)\s*\([^;{]*\)\s*(?:const\s*)?\{?\s*$/, C_LIKE],
  ['function', /^\s*(?:local\s+)?function\s+(?<n>[\w.:]+)/, ['lua']],
  ['function', /^\s*defp?\s+(?<n>[a-z_]\w*[?!]?)/, ['elixir']],
];
const SCOPED = new Set(DEF_PATTERNS.flatMap((p) => p[2] || []));

/** Extract definitions from source text. Returns [{name, kind, line, endLine}] (1-based). */
export function extractSymbols(text, lang) {
  if (!text) return [];
  if (['json', 'yaml', 'toml', 'markdown', 'text', 'xml', 'html', 'css'].includes(lang)) return [];
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.length > 400 || /^\s*(\/\/|#(?!include)|\*|\/\*|--)/.test(l)) continue;
    for (const [kind, re, langs] of DEF_PATTERNS) {
      if (langs && SCOPED.has(lang) && !langs.includes(lang)) continue; // unknown languages try every pattern
      const m = re.exec(l);
      if (!m || !m.groups || !m.groups.n) continue;
      const name = m.groups.n;
      if (KEYWORDS.has(name)) continue;
      out.push({ name, kind, line: i + 1, endLine: blockEnd(lines, i, lang) + 1 });
      break;
    }
  }
  return out;
}

function indentOf(s) { return s.match(/^\s*/)[0].replace(/\t/g, '    ').length; }

/** 0-based index of the last line of the block starting at `start`. */
export function blockEnd(lines, start, lang) {
  const useIndent = INDENT_LANGS.has(lang) || lang === 'ruby' || lang === 'elixir';
  if (!useIndent) {
    let depth = 0; let seen = false;
    for (let i = start; i < Math.min(lines.length, start + 2000); i++) {
      const s = stripStrings(lines[i]);
      for (const ch of s) {
        if (ch === '{') { depth++; seen = true; } else if (ch === '}') { depth--; }
      }
      if (seen && depth <= 0) return i;
      if (!seen && i - start >= 3) break; // no brace block -> fall back to indentation
      if (!seen && /;\s*$/.test(s) && i === start) return i; // declaration only
    }
    if (seen) return Math.min(lines.length - 1, start + 2000);
  }
  const base = indentOf(lines[start]);
  let last = start;
  for (let i = start + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const ind = indentOf(lines[i]);
    if (ind <= base) {
      if (ind === base && /^\s*[)\]]/.test(lines[i])) { last = i; continue; } // closing a multi-line signature: `) -> str:`
      if (ind === base && /^\s*(end\b|\})/.test(lines[i])) return i; // ruby/elixir `end`, brace-less fallback
      break;
    }
    last = i;
  }
  return last;
}

function stripStrings(s) {
  return s.replace(/\/\/.*$/, '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, '""');
}

/** The innermost symbol whose range contains `line`. */
export function enclosingSymbol(symbols, line) {
  let best = null;
  for (const s of symbols) {
    if (s.line <= line && line <= s.endLine && (!best || s.endLine - s.line < best.endLine - best.line)) best = s;
  }
  return best;
}

const IMPORT_PATTERNS = [
  /\bimport\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g,
  /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
  /\brequire(?:_relative)?\s*\(?\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /^\s*from\s+(\.*[\w.]*)\s+import\b/gm,
  /^\s*import\s+([\w.]+)(?:\s+as\s+\w+)?\s*$/gm, // python / java-ish
  /^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;/gm, // java
  /^\s*#\s*include\s+["<]([^">]+)[">]/gm,
  /^\s*use\s+([\w:\\]+)/gm, // rust / php
  /^\s*mod\s+(\w+)\s*;/gm, // rust
  /^\s*(?:\w+\s+)?"([\w./-]+)"\s*$/gm, // go import block
  /@import\s+['"]([^'"]+)['"]/g,
];

export function extractImports(text) {
  if (!text) return [];
  const specs = new Set();
  for (const re of IMPORT_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) if (m[1]) specs.add(m[1]);
  }
  return [...specs];
}

const RESOLVE_EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.d.ts', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.dart', '.php', '.scss', '.css'];
const INDEX_FILES = ['/index.ts', '/index.tsx', '/index.js', '/index.jsx', '/index.mjs', '/__init__.py', '/mod.rs'];

const FAMILIES = [
  ['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts', 'vue', 'svelte', 'json', 'css', 'scss', 'less'],
  ['py', 'pyi'], ['go'], ['rs'], ['java', 'kt', 'kts', 'scala', 'groovy'], ['c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'm', 'mm'],
  ['rb'], ['php'], ['css', 'scss', 'less'], ['dart'], ['swift'], ['cs'], ['ex', 'exs'], ['lua'],
];
const extOf = (f) => (f.includes('.') ? f.split('.').pop().toLowerCase() : '');
/** True when `target` can plausibly be imported from `from` (same language family). */
function sameFamily(from, target) {
  const a = extOf(from), b = extOf(target);
  const fams = FAMILIES.filter((fam) => fam.includes(a));
  return !fams.length || fams.some((fam) => fam.includes(b));
}

/** Resolve an import spec to repository files. `universe` is a Set of repo paths. */
export function resolveImport(fromFile, spec, universe, dirIndex) {
  const hits = resolveImportRaw(fromFile, spec, universe, dirIndex).filter((t) => sameFamily(fromFile, t));
  if (hits.length < 2) return hits;
  // Several suffix matches: keep only those nearest to the importer in the tree
  // (most shared leading directories), e.g. dags/elo/x.py over train-service/elo/x.py.
  const shared = (t) => { const a = fromFile.split('/'), b = t.split('/'); let n = 0; while (n < a.length - 1 && n < b.length - 1 && a[n] === b[n]) n++; return n; };
  const best = Math.max(...hits.map(shared));
  return hits.filter((t) => shared(t) === best);
}
function resolveImportRaw(fromFile, spec, universe, dirIndex) {
  const dir = path.posix.dirname(fromFile);
  const tryPath = (p) => {
    p = path.posix.normalize(p);
    for (const e of RESOLVE_EXTS) if (universe.has(p + e)) return [p + e];
    for (const e of INDEX_FILES) if (universe.has(p + e)) return [p + e];
    return null;
  };
  if (spec.startsWith('.')) {
    // python relative: from .foo import x / from ..pkg import y
    if (/^\.+[\w.]*$/.test(spec) && !spec.includes('/')) {
      const dots = spec.match(/^\.+/)[0].length;
      let base = dir;
      for (let i = 1; i < dots; i++) base = path.posix.dirname(base);
      const rest = spec.slice(dots).replace(/\./g, '/');
      return tryPath(rest ? path.posix.join(base, rest) : base) || [];
    }
    return tryPath(path.posix.join(dir, spec)) || [];
  }
  // alias-ish (@/foo, ~/foo, src/foo) and dotted module names: suffix match
  const cleaned = spec.replace(/^[@~]\//, '').replace(/^crate::/, '').replace(/::/g, '/').replace(/\\/g, '/');
  const candidates = new Set([cleaned]);
  if (/^[\w]+(\.[\w]+)+$/.test(cleaned) && !/\.(js|ts|py|go|rb)$/.test(cleaned)) candidates.add(cleaned.replace(/\./g, '/'));
  const hits = [];
  for (const c of candidates) {
    const direct = tryPath(c);
    if (direct) { hits.push(...direct); continue; }
    const suffix = '/' + c;
    for (const f of universe) {
      const noExt = f.replace(/\.[^./]+$/, '');
      const pkg = noExt.replace(/\/(__init__|index|mod)$/, ''); // python package / JS index / rust mod.rs
      if (noExt.endsWith(suffix) || noExt === c || f.endsWith(suffix) || ((pkg !== noExt) && (pkg.endsWith(suffix) || pkg === c))) { hits.push(f); if (hits.length > 8) break; }
    }
    // go: package path -> all files in that directory
    if (!hits.length && dirIndex) {
      for (const [d, files] of dirIndex) if (d.endsWith(suffix) || d === c) { hits.push(...files.slice(0, 5)); break; }
    }
  }
  return [...new Set(hits)];
}
