// Downloads /valve.zip and inflates it off the main thread, streaming each file back as a
// transferable so the page never freezes while 4,200 files are unpacked. The engine's
// filesystem lives on the main thread, so the bytes have to cross back — but a transfer is
// a move of the buffer, not a copy, so it is nearly free.

import { loadAsync } from 'jszip';

type ToWorker = { url: string };
type FromWorker =
    | { type: 'progress'; phase: 'download'; received: number; total: number }
    | { type: 'progress'; phase: 'unzip'; index: number; count: number; path: string }
    | { type: 'file'; path: string; bytes: Uint8Array }
    | { type: 'done'; count: number }
    | { type: 'error'; message: string };

const post = (message: FromWorker, transfer?: Transferable[]) =>
    (self as unknown as Worker).postMessage(message, transfer ?? []);

async function download(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    if (!response.ok || !response.body) throw new Error(`${url}: ${response.status}`);
    const total = Number(response.headers.get('Content-Length')) || 0;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        post({ type: 'progress', phase: 'download', received, total });
    }
    return new Blob(chunks as BlobPart[]).arrayBuffer();
}

self.onmessage = async (event: MessageEvent<ToWorker>) => {
    try {
        const zip = await loadAsync(await download(event.data.url));
        const files = Object.entries(zip.files).filter(([, file]) => !file.dir);
        for (let i = 0; i < files.length; i++) {
            const [path, file] = files[i];
            const bytes = await file.async('uint8array');
            post({ type: 'file', path, bytes }, [bytes.buffer]);
            if (i % 20 === 0) post({ type: 'progress', phase: 'unzip', index: i, count: files.length, path });
        }
        post({ type: 'done', count: files.length });
    } catch (error) {
        post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
};
