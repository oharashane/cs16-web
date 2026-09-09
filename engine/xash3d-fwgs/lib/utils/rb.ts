export interface RollingBufferOptions {
    maxSize: number
}

export class RollingBuffer<T> {
    public readonly opts: RollingBufferOptions;
    private readonly buffer: (T | undefined)[];
    private head: number = 0;
    private tail: number = 0;
    private count: number = 0;

    constructor(opts: RollingBufferOptions) {
        this.opts = opts;
        this.buffer = new Array(this.opts.maxSize);
    }

    push(item: T): void {
        if (this.isFull()) {
            this.tail = (this.tail + 1) % this.opts.maxSize;
        } else {
            this.count += 1;
        }
        this.buffer[this.head] = item;
        this.head = (this.head + 1) % this.opts.maxSize;
    }

    enqueue(item: T): void {
        this.push(item)
    }

    pull(): T | undefined {
        if (this.isEmpty()) return undefined;

        const item = this.buffer[this.tail];
        this.buffer[this.tail] = undefined;
        this.tail = (this.tail + 1) % this.opts.maxSize;
        this.count -= 1;
        return item;
    }

    peek(): T | undefined {
        return this.buffer[this.tail];
    }

    size(): number {
        return this.count;
    }

    isFull(): boolean {
        return this.count === this.opts.maxSize;
    }

    isEmpty(): boolean {
        return this.count === 0;
    }

    clear(): void {
        this.buffer.fill(undefined);
        this.head = 0;
        this.tail = 0;
        this.count = 0;
    }

    toArray(): T[] {
        const res: T[] = new Array(this.size())
        for (let i = 0; i < this.size(); ++i) {
            const idx = (this.tail + i) % this.opts.maxSize
            res[i] = this.buffer[idx]!
        }
        return res
    }
}