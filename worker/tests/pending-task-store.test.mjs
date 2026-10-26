import test from "node:test";
import assert from "node:assert/strict";
import { PendingTaskStore } from "../src/runtime/pending-task-store.mjs";

class MemoryState {
  constructor(data = {}) {
    this.data = structuredClone(data);
  }

  get(key, fallback) {
    return structuredClone(this.data[key] ?? fallback);
  }

  set(key, value) {
    this.data[key] = structuredClone(value);
  }
}

function createStore(state, now = () => Date.parse("2026-10-26T10:00:00+08:00")) {
  return new PendingTaskStore(state, { now });
}

test("本地短号持久化且跨会话不可见", () => {
  const state = new MemoryState();
  const first = createStore(state).create({
    chatId: "chat-a",
    operator: "测试甲",
    draftSpec: { weeklyRows: [], handoverRows: [] },
  });
  assert.equal(first.id, "1");

  const restarted = createStore(state);
  assert.equal(restarted.find("1", "chat-a").operator, "测试甲");
  assert.equal(restarted.find("1", "chat-b"), null);
  assert.equal(restarted.create({ chatId: "chat-a", draftSpec: {} }).id, "2");
});

test("短号只能领取一次，完成或取消后不能重复写入", () => {
  const state = new MemoryState();
  const store = createStore(state);
  store.create({ chatId: "chat-a", operator: "测试甲" });

  const first = store.claim("1", "chat-a");
  assert.equal(first.ok, true);
  assert.equal(store.claim("1", "chat-a").reason, "processing");

  store.complete("1", "chat-a", { weeklyRows: 1 });
  assert.equal(store.claim("1", "chat-a").reason, "completed");
  assert.equal(store.activeCount("chat-a"), 0);
});

test("处理中的旧任务可重新领取，失败任务可重试", () => {
  let now = Date.parse("2026-10-26T10:00:00+08:00");
  const state = new MemoryState();
  const store = createStore(state, () => now);
  store.create({ chatId: "chat-a", operator: "测试甲" });
  store.claim("1", "chat-a");
  now += 11 * 60 * 1000;
  assert.equal(store.claim("1", "chat-a").ok, true);

  store.fail("1", "chat-a", "网络错误");
  const failed = store.find("1", "chat-a");
  assert.equal(failed.status, "failed");
  assert.equal(failed.lastError, "网络错误");
  assert.equal(store.claim("1", "chat-a").ok, true);
});

test("旧四位短号自动迁移为普通数字", () => {
  const state = new MemoryState({
    __pendingTasks__: {
      counter: 1,
      tasks: {
        "0001": {
          id: "0001",
          chatId: "chat-a",
          status: "completed",
          createdAt: "2026-10-26T00:00:00.000Z",
          updatedAt: "2026-10-26T00:00:00.000Z",
        },
      },
    },
  });
  const store = createStore(state);
  assert.equal(store.find("1", "chat-a").id, "1");
  assert.equal(store.find("0001", "chat-a").id, "1");
  assert.equal(store.create({ chatId: "chat-a", draftSpec: {} }).id, "2");
});

test("飞书任务号确定后把临时短号改成任务列表后三位", () => {
  const state = new MemoryState();
  const store = createStore(state);
  store.create({ chatId: "chat-a", operator: "测试甲" });

  const updated = store.reassignId("1", "chat-a", "6");
  assert.equal(updated.id, "6");
  assert.equal(store.find("1", "chat-a"), null);
  assert.equal(store.find("6", "chat-a").operator, "测试甲");
});

test("跨日期复用任务号时保留已完成记录", () => {
  const state = new MemoryState();
  const store = createStore(state);
  store.create({ chatId: "chat-a", operator: "测试甲", currentDate: "20261025" });
  store.complete("1", "chat-a", { weeklyRows: 1 });
  store.reassignId("1", "chat-a", "6");
  store.create({ chatId: "chat-a", operator: "测试乙", currentDate: "20261026" });

  const updated = store.reassignId("7", "chat-a", "6");
  assert.equal(updated.id, "6");
  assert.equal(updated.operator, "测试乙");
  assert.equal(store.find("6", "chat-a").operator, "测试乙");
  assert.equal(store.find("6@20261025", "chat-a").operator, "测试甲");
});
