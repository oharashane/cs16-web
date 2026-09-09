// A cache of the unpacked game files, in IndexedDB, so a second visit skips both the
// download and the unzip. Keyed by the identity of /valve.zip (its Last-Modified and
// length): a new content build has a new key and the old files are cleared.
//
// Everything here is best-effort. A private window, a browser with storage disabled, a
// quota refusal — any of them throws, and the caller falls back to downloading. The cache
// is a convenience, never a dependency.

const DB_NAME = 'cs16-content';
const FILES = 'files';   // key: path (string) → value: Uint8Array
const META = 'meta';     // key: 'valve'         → value: { key: string, count: number }

function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES);
            if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function done(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error);
    });
}

/** A handle to the content cache, or null if this browser will not give us one. */
export class ContentCache {
    private constructor(private db: IDBDatabase) {}

    static async open(): Promise<ContentCache | null> {
        try {
            return new ContentCache(await open());
        } catch {
            return null;   // no IndexedDB, or blocked; the caller downloads instead
        }
    }

    /** The key of the cached content, or null if there is none. */
    async storedKey(): Promise<string | null> {
        try {
            const tx = this.db.transaction(META, 'readonly');
            const request = tx.objectStore(META).get('valve');
            await done(tx);
            return (request.result as { key: string } | undefined)?.key ?? null;
        } catch {
            return null;
        }
    }

    /** Read every cached file into the engine's filesystem, calling onProgress(0..1). */
    async readInto(write: (path: string, bytes: Uint8Array) => void, onProgress: (fraction: number) => void): Promise<number> {
        const meta = await this.meta();
        const total = meta?.count ?? 0;
        let seen = 0;
        await new Promise<void>((resolve, reject) => {
            const tx = this.db.transaction(FILES, 'readonly');
            const cursor = tx.objectStore(FILES).openCursor();
            cursor.onsuccess = () => {
                const c = cursor.result;
                if (!c) return;
                write(c.key as string, c.value as Uint8Array);
                if (total && ++seen % 100 === 0) onProgress(seen / total);
                c.continue();
            };
            tx.oncomplete = () => resolve();
            tx.onerror = tx.onabort = () => reject(tx.error);
        });
        return seen;
    }

    private async meta(): Promise<{ key: string; count: number } | undefined> {
        const tx = this.db.transaction(META, 'readonly');
        const request = tx.objectStore(META).get('valve');
        await done(tx);
        return request.result;
    }

    /** Discard whatever is cached; call before writing a new build's files. */
    async clear(): Promise<void> {
        const tx = this.db.transaction([FILES, META], 'readwrite');
        tx.objectStore(FILES).clear();
        tx.objectStore(META).clear();
        await done(tx);
    }

    /** Write a batch of files in one transaction. Batching keeps this to a few dozen
     *  transactions over the whole content rather than four thousand. */
    async putBatch(entries: [string, Uint8Array][]): Promise<void> {
        const tx = this.db.transaction(FILES, 'readwrite');
        const store = tx.objectStore(FILES);
        for (const [path, bytes] of entries) store.put(bytes, path);
        await done(tx);
    }

    /** Record that the cache now holds a complete build. Written last, so a crash
     *  mid-write leaves no key and the next visit re-downloads rather than trusting a
     *  half-filled cache. */
    async commit(key: string, count: number): Promise<void> {
        const tx = this.db.transaction(META, 'readwrite');
        tx.objectStore(META).put({ key, count }, 'valve');
        await done(tx);
    }
}
