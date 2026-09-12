export const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
export const mmss = (s: number) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(s % 60).padStart(2, '0'); };
export const mb = (b: number) => (b / 1048576).toFixed(b < 10 * 1048576 ? 1 : 0) + ' MB';
export const kb = (b: number) => b >= 1048576 ? mb(b) : Math.round(b / 1024).toLocaleString() + ' KB';
