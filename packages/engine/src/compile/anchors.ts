// Anchors (find / regex / symbol / hunk / line numbers) resolved to concrete line ranges,
// with diagnostics that say how to fix a miss.
import { blockEnd, extractSymbols } from '../repo/lang.ts';
import type { Anchor, AnchorObject, LineRange, Side, View } from '../ir/types.ts';
import type { CompileContext } from './context.ts';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function suggest(cx: CompileContext, anchor: AnchorObject, file: string, side: Side, re: RegExp | null): string {
  const other: Side = side === 'after' ? 'before' : 'after';
  const test = (l: string) => (re ? re.test(l) : l.includes(anchor.find!));
  const ol = cx.linesOf(file, other);
  if (ol) { const i = ol.findIndex(test); if (i >= 0) return `, but it is on the ${other} side (line ${i + 1}); add "side": "${other}" and use a view that shows it`; }
  if (!re && anchor.find) {
    const norm = (x: string) => x.replace(/\s+/g, ' ').trim().toLowerCase();
    const want = norm(anchor.find);
    const ls = cx.linesOf(file, side) || [];
    const i = ls.findIndex((l) => norm(l).includes(want));
    if (i >= 0) return `: near match (whitespace/case differs) at line ${i + 1}: ${ls[i].trim().slice(0, 80)}`;
    if (anchor.find.includes('\n')) return ': "find" matches within a single line; use "span" or "block" for multi-line ranges';
  }
  return '';
}

/** Resolve a range anchor to {side, from, to}, or null with an error recorded. */
export function resolveRange(cx: CompileContext, anchor: Anchor | undefined | null, file: string, view: View | undefined, where: string): LineRange | null {
  if (anchor === undefined || anchor === null) return null;
  let side: Side = (typeof anchor === 'object' && !Array.isArray(anchor) && anchor.side) || cx.defaultSide(file, view);
  const lines = () => cx.linesOf(file, side);
  const check = (from: number, to: number): LineRange | null => {
    const ls = lines();
    if (!ls) { cx.err(where, `"${file}" has no ${side} version`); return null; }
    if (!(from >= 1 && to >= from && to <= ls.length)) { cx.err(where, `lines ${from}-${to} out of range for ${file} (${side}, ${ls.length} lines)`); return null; }
    return { side, from, to };
  };
  if (typeof anchor === 'number') return check(anchor, anchor);
  if (Array.isArray(anchor)) return check(anchor[0], anchor[1] ?? anchor[0]);
  if (typeof anchor !== 'object') { cx.err(where, `bad anchor ${JSON.stringify(anchor)}`); return null; }
  const a = anchor;
  if (a.line !== undefined) return check(a.line, a.line + (a.span ? a.span - 1 : 0));
  if (a.lines) return check(a.lines[0], a.lines[1] ?? a.lines[0]);
  if (a.find !== undefined || a.regex !== undefined) {
    const ls = lines();
    if (!ls) { cx.err(where, `"${file}" has no ${side} version`); return null; }
    const re = a.regex !== undefined ? new RegExp(a.regex) : null;
    const nth = a.nth || 1;
    const match = (l: string) => (re ? re.test(l) : l.includes(a.find!));
    const what = `${re ? 'regex' : 'text'} ${JSON.stringify(a.find ?? a.regex)}`;
    if (!a.nth) {
      const all: number[] = [];
      for (let i = 0; i < ls.length; i++) if (match(ls[i])) all.push(i + 1);
      if (all.length > 1) cx.warn(where, `ambiguous anchor: ${what} matches ${all.length} lines in ${file} (${side}): lines ${all.slice(0, 6).join(', ')}${all.length > 6 ? ', …' : ''}; using ${all[0]}. Add "nth" or use a more specific string`);
    }
    let seen = 0;
    for (let i = 0; i < ls.length; i++) {
      if (!match(ls[i]) || ++seen !== nth) continue;
      if (a.block) return check(i + 1, blockEnd(ls, i, cx.ir.files[file].language) + 1);
      return check(i + 1, Math.min(ls.length, i + (a.span || 1)));
    }
    cx.err(where, `${what}${nth > 1 ? ` (nth ${nth})` : ''} not found in ${file} (${side})${suggest(cx, a, file, side, re)}`);
    return null;
  }
  if (a.symbol) {
    const ls = lines();
    if (!ls) { cx.err(where, `"${file}" has no ${side} version`); return null; }
    const syms = extractSymbols(ls.join('\n'), cx.ir.files[file].language || 'text').filter((s) => s.name === a.symbol);
    if (!syms.length) {
      const i = ls.findIndex((l) => new RegExp(`\\b${escapeRe(a.symbol!)}\\b`).test(l));
      if (i >= 0) { cx.warn(where, `symbol "${a.symbol}" not recognised as a definition in ${file}; using first occurrence (line ${i + 1})`); return check(i + 1, i + 1); }
      cx.err(where, `symbol "${a.symbol}" not found in ${file} (${side})`);
      return null;
    }
    const s = syms[(a.nth || 1) - 1] || syms[0];
    return check(s.line, a.head ? s.line : s.endLine);
  }
  if (a.hunk !== undefined) {
    const blocks = cx.changeBlocks(file);
    const b = blocks[a.hunk - 1];
    if (!b) { cx.err(where, `hunk ${a.hunk} does not exist in ${file} (${blocks.length} change blocks)`); return null; }
    if (a.side === 'before' || b.newFrom == null) { side = 'before'; return check(b.oldFrom!, b.oldTo!); }
    side = 'after';
    return check(b.newFrom, b.newTo!);
  }
  cx.err(where, `unrecognised anchor ${JSON.stringify(anchor)}`);
  return null;
}

export function resolvePoint(cx: CompileContext, anchor: Anchor | undefined, file: string, view: View | undefined, where: string): { side: Side; line: number; to: number } | null {
  const r = resolveRange(cx, anchor, file, view, where);
  return r && { side: r.side, line: r.from, to: r.to };
}
