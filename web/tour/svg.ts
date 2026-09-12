// A few strokes of SVG, enough for boxes, arrows and a timeline. A diagram library would
// cost every visitor a megabyte for the same picture.
const NS = 'http://www.w3.org/2000/svg';
export const el = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number> = {}, text?: string): SVGElementTagNameMap[K] => {
    const e = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text !== undefined) e.textContent = text;
    return e;
};
export function svg(width: number, height: number): SVGSVGElement {
    const s = el('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img' });
    const defs = el('defs');
    const marker = el('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
    marker.append(el('path', { d: 'M0,0 L10,5 L0,10 z', fill: '#9a9a9a' }));
    defs.append(marker);
    s.append(defs);
    return s;
}
export function box(s: SVGSVGElement, x: number, y: number, w: number, h: number, title: string, sub?: string, attrs: Record<string, string | number> = {}) {
    const g = el('g', { class: 'box', tabindex: 0, ...attrs });
    g.append(el('rect', { x, y, width: w, height: h, rx: 8, fill: '#1c1c1c', stroke: '#444', 'stroke-width': 1.2 }));
    g.append(el('text', { x: x + w / 2, y: y + (sub ? h / 2 - 4 : h / 2 + 5), 'text-anchor': 'middle', fill: '#e8e2cf', 'font-size': 14, 'font-weight': 600 }, title));
    if (sub) g.append(el('text', { x: x + w / 2, y: y + h / 2 + 14, 'text-anchor': 'middle', fill: '#9a9a9a', 'font-size': 12 }, sub));
    s.append(g);
    return g;
}
export function arrow(s: SVGSVGElement, x1: number, y1: number, x2: number, y2: number, label?: string, both = false) {
    s.append(el('line', { x1, y1, x2, y2, stroke: '#9a9a9a', 'stroke-width': 1.4, 'marker-end': 'url(#arrow)', ...(both ? { 'marker-start': 'url(#arrow)' } : {}) }));
    if (label) s.append(el('text', { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 8, 'text-anchor': 'middle', fill: '#9a9a9a', 'font-size': 12 }, label));
}
export const text = (s: SVGSVGElement, x: number, y: number, t: string, attrs: Record<string, string | number> = {}) => s.append(el('text', { x, y, fill: '#e8e2cf', 'font-size': 13, ...attrs }, t));
