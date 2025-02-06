import AsyncQueue from "./AsyncQueue";

export default class AsyncQueueStore<T> {
  queues = new Map<string, AsyncQueue<T>>();

  get(from: string, to: string) {
    const key = JSON.stringify([from, to]);

    let queue = this.queues.get(key);

    if (queue === undefined) {
      queue = new AsyncQueue<T>();
      this.queues.set(key, queue);
    }

    return queue;
  }
}
