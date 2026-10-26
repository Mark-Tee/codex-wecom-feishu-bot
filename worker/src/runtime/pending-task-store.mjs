const STATE_KEY = "__pendingTasks__";
const ACTIVE_STATUSES = new Set(["ready", "failed", "processing"]);
const PROCESSING_STALE_MS = 10 * 60 * 1000;

function clone(value) {
  return structuredClone(value);
}

function normalizeTaskId(value) {
  const id = String(value ?? "").trim().replace(/^#/, "");
  return /^\d+$/.test(id) ? String(Number(id)) : id;
}

function sameChat(task, chatId) {
  return String(task.chatId) === String(chatId);
}

export class PendingTaskStore {
  constructor(state, { now = () => Date.now(), processingStaleMs = PROCESSING_STALE_MS } = {}) {
    this.state = state;
    this.now = now;
    this.processingStaleMs = processingStaleMs;
    this.#migrateLegacyIds();
  }

  #migrateLegacyIds() {
    const data = this.#load();
    let changed = false;
    let maximum = Number(data.counter || 0);
    for (const [legacyId, task] of Object.entries(data.tasks)) {
      if (!/^0+\d+$/.test(legacyId)) continue;
      const normalizedId = String(Number(legacyId));
      if (data.tasks[normalizedId]) continue;
      delete data.tasks[legacyId];
      task.id = normalizedId;
      data.tasks[normalizedId] = task;
      maximum = Math.max(maximum, Number(normalizedId));
      changed = true;
    }
    if (changed) {
      data.counter = maximum;
      this.#save(data);
    }
  }

  #load() {
    const stored = this.state.get(STATE_KEY, {});
    return {
      counter: Number(stored.counter || 0),
      tasks: stored.tasks && typeof stored.tasks === "object" ? stored.tasks : {},
    };
  }

  #save(data) {
    this.state.set(STATE_KEY, data);
  }

  create(task) {
    const data = this.#load();
    let id;
    do {
      data.counter += 1;
      id = String(data.counter);
    } while (data.tasks[id]);

    const createdAt = new Date(this.now()).toISOString();
    const record = {
      ...clone(task),
      id,
      status: "ready",
      createdAt,
      updatedAt: createdAt,
      attempts: 0,
    };
    data.tasks[id] = record;
    this.#save(data);
    return clone(record);
  }

  find(id, chatId) {
    const task = this.#load().tasks[normalizeTaskId(id)];
    if (!task || !sameChat(task, chatId)) return null;
    return clone(task);
  }

  list(chatId, { limit = 10 } = {}) {
    return Object.values(this.#load().tasks)
      .filter((task) => sameChat(task, chatId) && ACTIVE_STATUSES.has(task.status))
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .slice(0, limit)
      .map(clone);
  }

  activeCount(chatId) {
    return Object.values(this.#load().tasks)
      .filter((task) => sameChat(task, chatId) && ACTIVE_STATUSES.has(task.status))
      .length;
  }

  claim(id, chatId) {
    const data = this.#load();
    const key = normalizeTaskId(id);
    const task = data.tasks[key];
    if (!task || !sameChat(task, chatId)) return { ok: false, reason: "not_found" };
    if (task.status === "completed" || task.status === "cancelled") {
      return { ok: false, reason: task.status, task: clone(task) };
    }
    const processingAge = this.now() - new Date(task.processingAt || 0).getTime();
    if (task.status === "processing" && processingAge < this.processingStaleMs) {
      return { ok: false, reason: "processing", task: clone(task) };
    }

    task.status = "processing";
    task.processingAt = new Date(this.now()).toISOString();
    task.updatedAt = task.processingAt;
    task.attempts = Number(task.attempts || 0) + 1;
    delete task.lastError;
    this.#save(data);
    return { ok: true, task: clone(task) };
  }

  complete(id, chatId, result = {}) {
    return this.#update(id, chatId, (task) => {
      task.status = "completed";
      task.completedAt = new Date(this.now()).toISOString();
      task.updatedAt = task.completedAt;
      task.result = clone(result);
      delete task.processingAt;
      delete task.lastError;
    });
  }

  setBrowserFill(id, chatId, result = {}) {
    return this.#update(id, chatId, (task) => {
      task.browserFill = {
        ...clone(result),
        at: new Date(this.now()).toISOString(),
      };
      task.updatedAt = task.browserFill.at;
    });
  }

  reassignId(id, chatId, nextId) {
    const data = this.#load();
    const key = normalizeTaskId(id);
    const target = normalizeTaskId(nextId);
    if (!/^\d+$/.test(target)) {
      throw new Error(`无效本地短号：${nextId}`);
    }
    const task = data.tasks[key];
    if (!task || !sameChat(task, chatId)) return null;
    if (target === key) return clone(task);

    const conflict = data.tasks[target];
    if (conflict) {
      if (!["completed", "cancelled"].includes(conflict.status)) {
        throw new Error(`任务列表短号 ${target} 已被未完成任务占用`);
      }
      const date = String(conflict.currentDate || conflict.completedAt || conflict.cancelledAt || "unknown")
        .replace(/[^0-9A-Za-z_-]/g, "");
      let archiveKey = `${target}@${date}`;
      let suffix = 2;
      while (data.tasks[archiveKey]) {
        archiveKey = `${target}@${date}#${suffix}`;
        suffix += 1;
      }
      data.tasks[archiveKey] = {
        ...conflict,
        archivedAt: new Date(this.now()).toISOString(),
      };
      delete data.tasks[target];
    }

    delete data.tasks[key];
    task.id = target;
    task.updatedAt = new Date(this.now()).toISOString();
    data.tasks[target] = task;
    data.counter = Math.max(Number(data.counter || 0), Number(target) || 0);
    this.#save(data);
    return clone(task);
  }

  fail(id, chatId, error) {
    return this.#update(id, chatId, (task) => {
      task.status = "failed";
      task.failedAt = new Date(this.now()).toISOString();
      task.updatedAt = task.failedAt;
      task.lastError = String(error || "未知错误").slice(0, 1000);
      delete task.processingAt;
    });
  }

  cancel(id, chatId) {
    return this.#update(id, chatId, (task) => {
      if (["completed", "cancelled", "processing"].includes(task.status)) return false;
      task.status = "cancelled";
      task.cancelledAt = new Date(this.now()).toISOString();
      task.updatedAt = task.cancelledAt;
      delete task.processingAt;
      return true;
    });
  }

  #update(id, chatId, mutator) {
    const data = this.#load();
    const task = data.tasks[normalizeTaskId(id)];
    if (!task || !sameChat(task, chatId)) return null;
    const changed = mutator(task);
    if (changed === false) return clone(task);
    this.#save(data);
    return clone(task);
  }
}
