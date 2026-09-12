// Thirty seconds of a real recording, made by the bench (bench/tour.mjs records the demo
// page playing). A visitor pays a few megabytes and no engine.
export function mount(root: HTMLElement, opts: { src: string; poster: string; caption: string; link: string }) {
    const fig = document.createElement('div'); fig.className = 'figure';
    const v = document.createElement('video');
    v.muted = true; v.autoplay = true; v.loop = true; v.playsInline = true; v.controls = true;
    v.poster = opts.poster; v.src = opts.src; v.style.width = '100%';
    v.addEventListener('error', () => {
        const img = document.createElement('img'); img.className = 'still'; img.src = opts.poster; img.alt = opts.caption;
        v.replaceWith(img);
    });
    const cap = document.createElement('p'); cap.className = 'caption';
    cap.innerHTML = `${opts.caption} <a href="${opts.link}">Open the full recording</a> — the game itself, about 200 MB the first time, cached after.`;
    fig.append(v, cap);
    root.append(fig);
}
