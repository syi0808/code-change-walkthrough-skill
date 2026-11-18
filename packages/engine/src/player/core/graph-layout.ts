// Layered graph layout tuned for legibility: crossing-reduced ordering, spread ports,
// label-aware column gaps, and collision-avoiding edge labels on opaque pills.
import type { GraphEdge, GraphNode } from '../../ir/types.ts';
import { esc, IR } from './env.ts';

/** Approximate text width (px) for 10–12px UI fonts: wide glyphs (CJK) count double. */
function textW(str: string | undefined, size: number): number {
  let w = 0;
  for (const ch of String(str || '')) w += /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? size : size * 0.6;
  return w;
}

interface N extends GraphNode { layer: number; ord: number; bc: number; w: number; x: number; y: number }
interface E extends GraphEdge { k: number; y1?: number; y2?: number }
type Box = { x: number; y: number; w: number; h: number };
type P2 = [number, number];

export function graphSvg(g: { nodes: GraphNode[]; edges: GraphEdge[] }): string {
  const nodes: N[] = g.nodes.map((n) => ({ ...n, layer: 0, ord: 0, bc: 0, w: 0, x: 0, y: 0 }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges: E[] = g.edges.filter((e) => byId.has(e.from) && byId.has(e.to) && e.from !== e.to).map((e, k) => ({ ...e, k }));
  const nodeOf = (id: string) => byId.get(id)!;
  // 1. layers: longest path from sources
  for (let it = 0; it < nodes.length; it++) {
    let changed = false;
    for (const e of edges) { const a = nodeOf(e.from), b = nodeOf(e.to); if (b.layer < a.layer + 1 && a.layer + 1 < nodes.length) { b.layer = a.layer + 1; changed = true; } }
    if (!changed) break;
  }
  const layers: N[][] = [];
  for (const n of nodes) (layers[n.layer] = layers[n.layer] || []).push(n);
  for (let L = 0; L < layers.length; L++) layers[L] = layers[L] || [];
  // 2. order within layers: barycentre sweeps down and up to reduce crossings
  const order = () => layers.forEach((ls) => ls.forEach((n, i) => (n.ord = i)));
  order();
  for (let sweep = 0; sweep < 4; sweep++) {
    const down = sweep % 2 === 0;
    for (let L = down ? 1 : layers.length - 2; down ? L < layers.length : L >= 0; L += down ? 1 : -1) {
      for (const n of layers[L]) {
        const nb = edges.filter((e) => (down ? e.to === n.id : e.from === n.id)).map((e) => nodeOf(down ? e.from : e.to)).filter((m) => m.layer === L + (down ? -1 : 1));
        n.bc = nb.length ? nb.reduce((a, m) => a + m.ord, 0) / nb.length : n.ord;
      }
      layers[L].sort((a, b) => a.bc - b.bc || a.ord - b.ord);
      order();
    }
  }
  // 3. geometry: node sizes, label-aware column gaps
  const nh = 44;
  for (const n of nodes) n.w = Math.max(96, Math.min(260, Math.max(textW(n.label || n.id, 12) + 28, textW(n.sub, 10) + 24)));
  const colW = layers.map((ls) => Math.max(96, ...ls.map((n) => n.w)));
  const gapAfter = layers.map((_, L) => {
    const lab = edges.filter((e) => nodeOf(e.from).layer === L && nodeOf(e.to).layer > L).map((e) => (e.label ? textW(e.label, 10) + 16 : 0));
    return Math.max(64, (lab.length ? Math.max(...lab) : 0) + 40);
  });
  const maxRows = Math.max(...layers.map((l) => l.length));
  const gapY = edges.length / Math.max(1, nodes.length) > 1.2 ? 30 : 22;
  let x = 12;
  layers.forEach((ls, L) => { ls.forEach((n, i) => { n.x = x + (colW[L] - n.w) / 2; n.y = 30 + i * (nh + gapY); }); x += colW[L] + (L < layers.length - 1 ? gapAfter[L] : 0); });
  const width = x + 12, height = 30 + maxRows * (nh + gapY) - gapY + 30;
  layers.forEach((ls) => { const h = ls.length * (nh + gapY) - gapY; for (const n of ls) n.y += (height - 60 - h) / 2; });
  // 4. ports: spread each node's outgoing / incoming edges along its height
  const fwd = edges.filter((e) => nodeOf(e.to).layer > nodeOf(e.from).layer);
  for (const n of nodes) {
    const outs = fwd.filter((e) => e.from === n.id).sort((a, b) => nodeOf(a.to).y - nodeOf(b.to).y);
    outs.forEach((e, i) => (e.y1 = n.y + (nh * (i + 1)) / (outs.length + 1)));
    const ins = fwd.filter((e) => e.to === n.id).sort((a, b) => nodeOf(a.from).y - nodeOf(b.from).y);
    ins.forEach((e, i) => (e.y2 = n.y + (nh * (i + 1)) / (ins.length + 1)));
  }
  // 5. paths + labels with collision avoidance
  const boxes: Box[] = nodes.map((n) => ({ x: n.x - 4, y: n.y - 4, w: n.w + 8, h: nh + 8 }));
  const hit = (b: Box) => boxes.some((o) => b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h);
  const bez = (P: P2[], t: number): P2 => { const u = 1 - t; const f = (k: 0 | 1) => u * u * u * P[0][k] + 3 * u * u * t * P[1][k] + 3 * u * t * t * P[2][k] + t * t * t * P[3][k]; return [f(0), f(1)]; };
  let out = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" style="--w:${width}px" xmlns="http://www.w3.org/2000/svg" role="img"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>`;
  const parts: string[] = [];
  for (const e of edges) {
    const a = nodeOf(e.from), b = nodeOf(e.to);
    let P: P2[];
    if (b.layer > a.layer) {
      const x1 = a.x + a.w, y1 = e.y1 ?? a.y + nh / 2, x2 = b.x - 2, y2 = e.y2 ?? b.y + nh / 2, c = Math.max(24, (x2 - x1) * 0.5);
      P = [[x1, y1], [x1 + c, y1], [x2 - c, y2], [x2, y2]];
    } else { // same layer or backwards: arc over the top
      const x1 = a.x + a.w / 2, y1 = a.y, x2 = b.x + b.w / 2, y2 = b.y - 2, top = Math.min(y1, y2) - 28 - Math.abs(x2 - x1) * 0.08;
      P = [[x1, y1], [x1, top], [x2, top], [x2, y2]];
    }
    const d = `M${P[0][0]} ${P[0][1]} C${P[1][0]} ${P[1][1]} ${P[2][0]} ${P[2][1]} ${P[3][0]} ${P[3][1]}`;
    let lbl = '';
    if (e.label) {
      const lw = textW(e.label, 10) + 12, lh = 16;
      let best: Box | null = null;
      for (const t of [0.5, 0.38, 0.62, 0.28, 0.72, 0.2, 0.8]) {
        const [cx, cy] = bez(P, t);
        for (const dy of [0, -11, 11]) {
          const box = { x: cx - lw / 2, y: cy - lh / 2 + dy, w: lw, h: lh };
          if (!hit(box)) { best = box; break; }
        }
        if (best) break;
      }
      if (!best) { const [cx, cy] = bez(P, 0.5); best = { x: cx - lw / 2, y: cy - lh / 2, w: lw, h: lh }; }
      boxes.push({ x: best.x - 3, y: best.y - 2, w: best.w + 6, h: best.h + 4 });
      lbl = `<g class="lbl"><rect x="${best.x.toFixed(1)}" y="${best.y.toFixed(1)}" width="${lw.toFixed(1)}" height="${lh}" rx="8"/><text x="${(best.x + lw / 2).toFixed(1)}" y="${(best.y + 11.5).toFixed(1)}" text-anchor="middle">${esc(e.label)}</text></g>`;
    }
    parts.push(`<g class="g-edge${e.style === 'dashed' ? ' dashed' : ''}" data-from="${esc(e.from)}" data-to="${esc(e.to)}" style="--i:${e.k + nodes.length}"><path d="${d}" marker-end="url(#ah)" pathLength="1"/>${lbl}</g>`);
  }
  out += parts.join(''); // edges under nodes; a label is drawn with its edge so highlights toggle both
  nodes.forEach((n, k) => {
    const status = n.status || (n.file && IR.files[n.file] ? IR.files[n.file].status : 'context');
    out += `<g class="g-node ${status}" data-id="${esc(n.id)}"${n.file ? ` data-file="${esc(n.file)}"` : ''} style="--i:${k}"><rect x="${n.x}" y="${n.y}" width="${n.w}" height="${nh}" rx="7"/><text x="${n.x + n.w / 2}" y="${n.y + (n.sub ? 18 : 27)}" text-anchor="middle">${esc(n.label || n.id)}</text>${n.sub ? `<text class="sub" x="${n.x + n.w / 2}" y="${n.y + 34}" text-anchor="middle">${esc(n.sub)}</text>` : ''}</g>`;
  });
  return out + '</svg>';
}
