export class TaskQueue {
  constructor(handler, { logger } = {}) {
    this.handler = handler;
    this.logger = logger;
    this.items = [];
    this.running = false;
  }

  get size() {
    return this.items.length;
  }

  push(task) {
    this.items.push(task);
    if (!this.running) this.#drain();
  }

  clear() {
    this.items.length = 0;
  }

  async #drain() {
    this.running = true;
    try {
      while (this.items.length) {
        const task = this.items.shift();
        try {
          await this.handler(task);
        } catch (error) {
          this.logger?.error("task failed", error.message);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
