export interface QueueNode<T> {
    value: T
    next?: QueueNode<T>
}

export class Queue<T> {
    private head?: QueueNode<T>
    private tail?: QueueNode<T>
    private size = 0

    enqueue(value: T) {
        const newNode = {value}
        if (!this.tail) {
            this.head = this.tail = newNode;
        } else {
            this.tail.next = newNode;
            this.tail = newNode;
        }
        this.size += 1
    }

    dequeue() {
        if (!this.head) return undefined;

        const dequeuedValue = this.head.value;
        this.head = this.head.next;
        if (!this.head) this.tail = undefined;

        this.size -= 1;
        return dequeuedValue;
    }
}