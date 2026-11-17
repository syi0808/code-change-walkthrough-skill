// VENDORED from packages/engine/src/lib — do not edit here; run tools/sync-skill-lib.mjs
// Git access layer. Every function is pure I/O over `git` so the analysis
// layer stays language/framework agnostic.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const WORKTREE = 'WORKTREE';

export function git(repo, args, { allowFail = false } = {}) {
  try {
    // core.quotepath=false: keep non-ASCII paths verbatim (otherwise git grep / diff quote them)
    return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
      cwd: repo,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (allowFail) return null;
    const msg = (err.stderr || err.message || '').toString().trim();
    throw new Error(`git ${args.join(' ')} failed: ${msg}`);
  }
}

export function repoRoot(dir) {
  return git(dir, ['rev-parse', '--show-toplevel']).trim();
}

export function revParse(repo, ref) {
  if (ref === WORKTREE) return WORKTREE;
  const out = git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { allowFail: true });
  return out ? out.trim() : null;
}

/**
 * Resolve the comparison range.
 *  - { range: 'a..b' }   -> base=a, head=b
 *  - { range: 'a...b' }  -> base=merge-base(a,b), head=b
 *  - { base, head }      -> as given (head defaults to WORKTREE when base is given alone)
 *  - nothing             -> uncommitted changes vs HEAD; if clean, last commit (HEAD~1..HEAD)
 */
export function resolveRange(repo, { range, base, head } = {}) {
  if (range) {
    const three = range.includes('...');
    const [a, b] = range.split(three ? '...' : '..');
    head = b || 'HEAD';
    base = three ? git(repo, ['merge-base', a, head]).trim() : a;
  }
  if (!base && !head) {
    const dirty = git(repo, ['status', '--porcelain']).trim().length > 0;
    if (dirty) { base = 'HEAD'; head = WORKTREE; }
    else { base = 'HEAD~1'; head = 'HEAD'; }
  }
  if (base && !head) head = WORKTREE;
  if (!base) base = head === WORKTREE ? 'HEAD' : `${head}~1`;
  const baseSha = revParse(repo, base);
  const headSha = revParse(repo, head);
  if (!baseSha) throw new Error(`Unknown base ref: ${base}`);
  if (!headSha) throw new Error(`Unknown head ref: ${head}`);
  return { base, head, baseSha, headSha };
}

const fileCache = new Map();
export function readAt(repo, ref, file) {
  const key = `${repo}\0${ref}\0${file}`;
  if (fileCache.has(key)) return fileCache.get(key);
  let text = null;
  if (ref === WORKTREE) {
    const abs = path.join(repo, file);
    try { if (fs.statSync(abs).isFile()) text = fs.readFileSync(abs, 'utf8'); } catch { text = null; }
  } else {
    text = git(repo, ['show', `${ref}:${file}`], { allowFail: true });
  }
  if (text !== null && text.includes('\u0000')) text = null; // binary
  // Normalise line endings: a Windows checkout (core.autocrlf) has CRLF in the
  // working tree but LF in the object store; without this every line would diff.
  if (text !== null) text = text.replace(/\r\n/g, '\n');
  fileCache.set(key, text);
  return text;
}

function diffArgs(range, extra, paths) {
  const args = ['diff', '--no-color', '--no-ext-diff', '-M', ...extra, range.base];
  if (range.head !== WORKTREE) args.push(range.head);
  if (paths) args.push('--', ...paths);
  return args;
}

/** List changed files with status. Includes untracked files for WORKTREE. */
export function changedFiles(repo, range) {
  const out = git(repo, diffArgs(range, ['--name-status', '-z']));
  const parts = out.split('\u0000').filter((s) => s.length);
  const files = [];
  for (let i = 0; i < parts.length;) {
    const code = parts[i++];
    const kind = code[0];
    if (kind === 'R' || kind === 'C') {
      const oldPath = parts[i++];
      const newPath = parts[i++];
      files.push({ path: newPath, oldPath, status: kind === 'R' ? 'renamed' : 'copied', similarity: Number(code.slice(1)) || null });
    } else {
      const p = parts[i++];
      files.push({ path: p, status: { A: 'added', D: 'deleted', M: 'modified', T: 'modified' }[kind] || 'modified' });
    }
  }
  if (range.head === WORKTREE) {
    const untracked = git(repo, ['ls-files', '--others', '--exclude-standard', '-z']).split('\u0000').filter(Boolean);
    for (const p of untracked) if (!files.some((f) => f.path === p)) files.push({ path: p, status: 'added', untracked: true });
  }
  const numstat = git(repo, diffArgs(range, ['--numstat', '-z']));
  // numstat -z: "add\tdel\tpath\0" or "add\tdel\t\0old\0new\0" for renames
  const ns = numstat.split('\u0000');
  for (let i = 0; i < ns.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(ns[i]);
    if (!m) continue;
    let p = m[3];
    if (p === '') { i += 2; p = ns[i]; }
    const f = files.find((x) => x.path === p);
    if (f) { f.additions = m[1] === '-' ? null : Number(m[1]); f.deletions = m[2] === '-' ? null : Number(m[2]); f.binary = m[1] === '-'; }
  }
  for (const f of files) {
    if (f.untracked) {
      const t = readAt(repo, WORKTREE, f.path);
      f.additions = t === null ? null : lineCount(t); f.deletions = 0; f.binary = t === null;
    }
  }
  return files;
}

/** Parse zero-context hunks for one file. */
export function hunks(repo, range, file) {
  if (file.untracked) {
    const t = readAt(repo, WORKTREE, file.path) || '';
    const n = lineCount(t);
    return [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: n, header: '' }];
  }
  const paths = file.oldPath ? [file.oldPath, file.path] : [file.path];
  const out = git(repo, diffArgs(range, ['-U0'], paths), { allowFail: true }) || '';
  const res = [];
  const re = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/gm;
  let m;
  while ((m = re.exec(out))) {
    res.push({
      oldStart: Number(m[1]), oldLines: m[2] === undefined ? 1 : Number(m[2]),
      newStart: Number(m[3]), newLines: m[4] === undefined ? 1 : Number(m[4]),
      header: m[5] || '',
    });
  }
  return res;
}

export function listFiles(repo, ref) {
  const args = ref === WORKTREE ? ['ls-files', '-z', '--cached', '--others', '--exclude-standard'] : ['ls-tree', '-r', '--name-only', '-z', ref];
  return git(repo, args).split('\u0000').filter(Boolean);
}

export function commits(repo, range) {
  if (range.head === WORKTREE) return [];
  const out = git(repo, ['log', '--format=%H%x1f%s%x1f%b%x1e', `${range.baseSha}..${range.headSha}`], { allowFail: true }) || '';
  return out.split('\u001e').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [sha, subject, body] = s.split('\u001f');
    return { sha: sha.slice(0, 10), subject, body: (body || '').trim() };
  });
}

/** Whole-word, fixed-string search across the repository at `ref`. */
export function grepWord(repo, ref, word, { limit = 60 } = {}) {
  const args = ['grep', '-n', '-w', '-I', '-F', '--full-name', '-e', word];
  if (ref !== WORKTREE) args.push(ref);
  args.push('--');
  const out = git(repo, args, { allowFail: true }) || '';
  const hits = [];
  for (const line of out.split('\n')) {
    if (!line) continue;
    // with a ref prefix: "<ref>:path:line:text"
    let rest = line;
    if (ref !== WORKTREE && rest.startsWith(`${ref}:`)) rest = rest.slice(ref.length + 1);
    const m = /^(.*?):(\d+):(.*)$/.exec(rest);
    if (!m) continue;
    hits.push({ file: m[1], line: Number(m[2]), text: m[3].trim().slice(0, 200) });
    if (hits.length > limit) break;
  }
  return hits;
}

function lineCount(t) { return t === '' ? 0 : t.split('\n').length - (t.endsWith('\n') ? 1 : 0); }
