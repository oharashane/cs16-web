// A cache of the unpacked game files, in IndexedDB, so a second visit skips both the
// download and the unzip. Files are keyed by path; each bundle (the base, and one per
// map) records the sha256 of the zip it came from, which is what content/manifest.json
// says the current one is: a bundle whose sha still matches is complete and current, one
// that does not is fetched again. A new base clears everything, since its files are most
// of what there is.
//
// Everything here is best-effort. A private window, a browser with storage disabled, a
// quota refusal — any of them throws, and the caller falls back to downloading. The cache
// is a convenience, never a dependency.

const DB_NAME = 'cs16-content';
const FILES = 'files';   // key: path (string)          → value: Uint8Array
const META = 'meta';     // key: 'bundle:<name>'        → value: { sha256: string, count: number }

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

    /** The sha256 of the bundle as cached, or null if it is not. */
    async bundleSha(name: string): Promise<string | null> {
        try {
            const tx = this.db.transaction(META, 'readonly');
            const request = tx.objectStore(META).get('bundle:' + name);
            await done(tx);
            return (request.result as { sha256: string } | undefined)?.sha256 ?? null;
        } catch {
            return null;
        }
    }

    /** How many files the cache holds altogether, across bundles. */
    async count(): Promise<number> {
        const tx = this.db.transaction(FILES, 'readonly');
        const request = tx.objectStore(FILES).count();
        await done(tx);
        return request.result;
    }

    /** Read every cached file into the engine's filesystem — whatever bundles are there;
     *  the caller decides from the shas which of them are current. */
    async readInto(write: (path: string, bytes: Uint8Array) => void, onProgress: (seen: number, total: number, path: string) => void): Promise<number> {
        const total = await this.count();
        let seen = 0;
        await new Promise<void>((resolve, reject) => {
            const tx = this.db.transaction(FILES, 'readonly');
            const cursor = tx.objectStore(FILES).openCursor();
            cursor.onsuccess = () => {
                const c = cursor.result;
                if (!c) return;
                write(c.key as string, c.value as Uint8Array);
                if (++seen % 25 === 0) onProgress(seen, total, c.key as string);
                c.continue();
            };
            tx.oncomplete = () => resolve();
            tx.onerror = tx.onabort = () => reject(tx.error);
        });
        return seen;
    }

    /** Discard everything; for a new base, whose files are most of what there is. */
    async clear(): Promise<void> {
        const tx = this.db.transaction([FILES, META], 'readwrite');
        tx.objectStore(FILES).clear();
        tx.objectStore(META).clear();
        await done(tx);
    }

    /** Write a batch of files in one transaction. Batching keeps this to a few dozen
     *  transactions over a bundle rather than one per file. */
    async putBatch(entries: [string, Uint8Array][]): Promise<void> {
        const tx = this.db.transaction(FILES, 'readwrite');
        const store = tx.objectStore(FILES);
        for (const [path, bytes] of entries) store.put(bytes, path);
        await done(tx);
    }

    /** Record that a bundle is complete. Written last, so a crash mid-write leaves no
     *  record and the next visit fetches the bundle again rather than trusting half of it. */
    async commit(name: string, sha256: string, count: number): Promise<void> {
        const tx = this.db.transaction(META, 'readwrite');
        tx.objectStore(META).put({ sha256, count }, 'bundle:' + name);
        await done(tx);
    }
}
