// A clock that keeps going when the tab does not. A browser stops requestAnimationFrame
// for a page that is not in front and slows its timers to a crawl, but a worker's timer
// runs on; each tick is a message, and messages are delivered to a hidden page. The page
// runs one engine frame per tick, so the game keeps talking to the server.

let timer: ReturnType<typeof setInterval> | undefined;
self.onmessage = (event: MessageEvent<{ every: number } | { stop: true }>) => {
    if (timer) clearInterval(timer);
    timer = undefined;
    if ('every' in event.data) timer = setInterval(() => (self as unknown as Worker).postMessage(0), event.data.every);
};
