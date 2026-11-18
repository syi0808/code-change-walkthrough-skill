// Diff engine shared by the compiler (Node) and the player (browser).
// "myers" gives a minimal edit script; "patience" anchors on unique lines and keeps
// moved blocks and brace-heavy code readable. Both get a slider heuristic and line
// pairing for word-level highlighting.

type Op = ['=' | '-' | '+', number, number];
type Seq = readonly string[];

export interface Segment { text: string; changed: boolean }
export interface DiffRow {
  type: 'eq' | 'del' | 'add' | 'mod';
  old?: number;
  new?: number;
  oldText?: string;
  newText?: string;
  ws?: boolean;
  segOld?: Segment[] | null;
  segNew?: Segment[] | null;
}
export interface DiffOptions { algorithm?: 'myers' | 'patience'; granularity?: 'line' | 'word' }

export function myers(a: Seq, b: Seq, aLo: number, aHi: number, bLo: number, bHi: number, out: Op[]): Op[] {
  while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) { out.push(['=', aLo, bLo]); aLo++; bLo++; }
  const tail: Op[] = [];
  while (aLo < aHi && bLo < bHi && a[aHi - 1] === b[bHi - 1]) { aHi--; bHi--; tail.push(['=', aHi, bHi]); }
  const n = aHi - aLo, m = bHi - bLo;
  if (n === 0 || m === 0) {
    for (let i = aLo; i < aHi; i++) out.push(['-', i, -1]);
    for (let j = bLo; j < bHi; j++) out.push(['+', -1, j]);
  } else {
    const LIMIT = 2500;
    const trace: Int32Array[] = [];
    let found = -1;
    let prev: Int32Array | null = null;
    for (let d = 0; d <= Math.min(n + m, LIMIT); d++) {
      const cur = new Int32Array(2 * d + 3);
      const get = (kk: number) => prev![kk + (d - 1) + 1];
      for (let k = -d; k <= d; k += 2) {
        let x: number;
        if (d === 0) x = 0;
        else if (k === -d || (k !== d && get(k - 1) < get(k + 1))) x = get(k + 1);
        else x = get(k - 1) + 1;
        let y = x - k;
        while (x < n && y < m && a[aLo + x] === b[bLo + y]) { x++; y++; }
        cur[k + d + 1] = x;
        if (x >= n && y >= m) { found = d; break; }
      }
      trace.push(cur); prev = cur;
      if (found >= 0) break;
    }
    if (found < 0) {
      // too different: one replacement block
      for (let i = aLo; i < aHi; i++) out.push(['-', i, -1]);
      for (let j = bLo; j < bHi; j++) out.push(['+', -1, j]);
    } else {
      const ops: Op[] = [];
      let x = n, y = m;
      for (let d = found; d > 0; d--) {
        const p = trace[d - 1];
        const k = x - y;
        const get = (kk: number) => p[kk + (d - 1) + 1];
        const down = k === -d || (k !== d && get(k - 1) < get(k + 1));
        const pk = down ? k + 1 : k - 1;
        const px = get(pk), py = px - pk;
        const midX = down ? px : px + 1, midY = midX - k;
        while (x > midX && y > midY) { ops.push(['=', aLo + x - 1, bLo + y - 1]); x--; y--; }
        if (down) ops.push(['+', -1, bLo + y - 1]); else ops.push(['-', aLo + x - 1, -1]);
        x = px; y = py;
      }
      while (x > 0 && y > 0) { ops.push(['=', aLo + x - 1, bLo + y - 1]); x--; y--; }
      for (let i = ops.length - 1; i >= 0; i--) out.push(ops[i]);
    }
  }
  for (let i = tail.length - 1; i >= 0; i--) out.push(tail[i]);
  return out;
}

export function patience(a: Seq, b: Seq, aLo: number, aHi: number, bLo: number, bHi: number, out: Op[], depth: number): Op[] {
  while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) { out.push(['=', aLo, bLo]); aLo++; bLo++; }
  const tail: Op[] = [];
  while (aLo < aHi && bLo < bHi && a[aHi - 1] === b[bHi - 1]) { aHi--; bHi--; tail.push(['=', aHi, bHi]); }
  const countA = new Map<string, number>(), countB = new Map<string, number>();
  for (let i = aLo; i < aHi; i++) countA.set(a[i], countA.has(a[i]) ? -1 : i);
  for (let j = bLo; j < bHi; j++) countB.set(b[j], countB.has(b[j]) ? -1 : j);
  const pairs: [number, number][] = [];
  for (const [line, i] of countA) {
    if (i < 0 || !line.trim()) continue;
    const j = countB.get(line);
    if (j !== undefined && j >= 0) pairs.push([i, j]);
  }
  pairs.sort((p, q) => p[0] - q[0]);
  // longest increasing subsequence on j (patience sorting)
  const piles: number[] = [], back = new Array<number>(pairs.length);
  for (let p = 0; p < pairs.length; p++) {
    const j = pairs[p][1];
    let lo = 0, hi = piles.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pairs[piles[mid]][1] < j) lo = mid + 1; else hi = mid; }
    back[p] = lo > 0 ? piles[lo - 1] : -1;
    piles[lo] = p;
  }
  const lis: [number, number][] = [];
  for (let p = piles.length ? piles[piles.length - 1] : -1; p >= 0; p = back[p]) lis.push(pairs[p]);
  lis.reverse();
  if (!lis.length || depth > 64) {
    myers(a, b, aLo, aHi, bLo, bHi, out);
  } else {
    let ai = aLo, bj = bLo;
    for (const [i, j] of lis) {
      patience(a, b, ai, i, bj, j, out, depth + 1);
      out.push(['=', i, j]);
      ai = i + 1; bj = j + 1;
    }
    patience(a, b, ai, aHi, bj, bHi, out, depth + 1);
  }
  for (let i = tail.length - 1; i >= 0; i--) out.push(tail[i]);
  return out;
}

/** Slider heuristic: a pure insert/delete block that can slide prefers to end before a blank line or a closer. */
function slide(ops: Op[], a: Seq, b: Seq): Op[] {
  for (let s = 0; s < ops.length; s++) {
    const kind = ops[s][0];
    if (kind === '=') continue;
    let e = s; while (e + 1 < ops.length && ops[e + 1][0] === kind) e++;
    const pure = (s === 0 || ops[s - 1][0] === '=') && (e + 1 >= ops.length || ops[e + 1][0] === '=');
    if (pure) {
      const lineOf = (op: Op) => (kind === '-' ? a[op[1]] : b[op[2]]);
      const candidates = [0];
      let down = 0;
      while (e + 1 + down < ops.length && ops[e + 1 + down][0] === '=' && lineOf(ops[s + down]) === lineOf(ops[e + 1 + down])) { down++; candidates.push(down); }
      let best = 0;
      for (const c of candidates) {
        const after = e + 1 + c < ops.length ? lineOf(ops[e + 1 + c]) : '';
        const last = lineOf(ops[e + c]);
        if ((after !== undefined && !String(after).trim()) || /^\s*[}\])]/.test(String(last))) best = c;
      }
      for (let c = 0; c < best; c++) {
        const first = ops[s + c], eq = ops[e + 1 + c];
        if (kind === '-') { ops[s + c] = ['=', first[1], eq[2]]; ops[e + 1 + c] = ['-', eq[1], -1]; }
        else { ops[s + c] = ['=', eq[1], first[2]]; ops[e + 1 + c] = ['+', -1, eq[2]]; }
      }
    }
    s = e;
  }
  return ops;
}

const tokenize = (s: string): string[] => s.match(/\s+|[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$]/g) || [];
function pushSeg(arr: Segment[], text: string, changed: boolean) {
  const last = arr[arr.length - 1];
  if (last && last.changed === changed) last.text += text; else arr.push({ text, changed });
}
export function wordDiff(x: string, y: string): { left: Segment[]; right: Segment[]; similarity: number } {
  const ta = tokenize(x), tb = tokenize(y);
  const ops = myers(ta, tb, 0, ta.length, 0, tb.length, []);
  const left: Segment[] = [], right: Segment[] = [];
  let same = 0;
  for (const [k, i, j] of ops) {
    if (k === '=') { pushSeg(left, ta[i], false); pushSeg(right, tb[j], false); same += ta[i].trim() ? ta[i].length : 0; }
    else if (k === '-') pushSeg(left, ta[i], true); else pushSeg(right, tb[j], true);
  }
  const total = Math.max(x.replace(/\s/g, '').length, y.replace(/\s/g, '').length) || 1;
  return { left, right, similarity: same / total };
}

/** Greedy in-order pairing of similar removed/added lines (similarity >= .45). */
function pairLines(dl: string[], ad: string[], words: boolean): [number, number, ReturnType<typeof wordDiff> | null][] {
  const out: [number, number, ReturnType<typeof wordDiff> | null][] = [];
  let j0 = 0;
  for (let i = 0; i < dl.length && j0 < ad.length; i++) {
    for (let j = j0; j < Math.min(ad.length, j0 + 6); j++) {
      const w = wordDiff(dl[i], ad[j]);
      if (w.similarity >= 0.45) { out.push([i, j, words ? w : null]); j0 = j + 1; break; }
    }
  }
  return out;
}

export function splitLines(t: string): string[] {
  const lines = t.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((l) => l.replace(/\r$/, ''));
}

/** Display rows for two texts. */
export function compute(beforeText: string | null | undefined, afterText: string | null | undefined, opts: DiffOptions = {}): { rows: DiffRow[]; stats: { additions: number; deletions: number } } {
  const a = beforeText == null ? [] : splitLines(beforeText);
  const b = afterText == null ? [] : splitLines(afterText);
  let ops = opts.algorithm === 'myers' ? myers(a, b, 0, a.length, 0, b.length, []) : patience(a, b, 0, a.length, 0, b.length, [], 0);
  ops = slide(ops, a, b);
  const rows: DiffRow[] = [];
  let adds = 0, dels = 0;
  for (let s = 0; s < ops.length;) {
    if (ops[s][0] === '=') { rows.push({ type: 'eq', old: ops[s][1] + 1, new: ops[s][2] + 1, oldText: a[ops[s][1]], newText: b[ops[s][2]] }); s++; continue; }
    const dl: number[] = [], ad: number[] = [];
    while (s < ops.length && ops[s][0] !== '=') { if (ops[s][0] === '-') dl.push(ops[s][1]); else ad.push(ops[s][2]); s++; }
    dels += dl.length; adds += ad.length;
    const paired = pairLines(dl.map((i) => a[i]), ad.map((j) => b[j]), opts.granularity !== 'line');
    let di = 0, aj = 0;
    for (const p of paired) {
      while (di < p[0]) { rows.push({ type: 'del', old: dl[di] + 1, oldText: a[dl[di]] }); di++; }
      while (aj < p[1]) { rows.push({ type: 'add', new: ad[aj] + 1, newText: b[ad[aj]] }); aj++; }
      const w = p[2];
      const ws = a[dl[di]].replace(/\s+/g, ' ').trim() === b[ad[aj]].replace(/\s+/g, ' ').trim();
      rows.push({ type: 'mod', ws, old: dl[di] + 1, new: ad[aj] + 1, oldText: a[dl[di]], newText: b[ad[aj]], segOld: w && w.left, segNew: w && w.right });
      di++; aj++;
    }
    while (di < dl.length) { rows.push({ type: 'del', old: dl[di] + 1, oldText: a[dl[di]] }); di++; }
    while (aj < ad.length) { rows.push({ type: 'add', new: ad[aj] + 1, newText: b[ad[aj]] }); aj++; }
  }
  return { rows, stats: { additions: adds, deletions: dels } };
}
