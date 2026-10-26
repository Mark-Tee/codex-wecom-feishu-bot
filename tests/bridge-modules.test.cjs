const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createAnswerCache } = require("../lib/answer-cache.cjs");
const { createHelpRouter } = require("../lib/help-router.cjs");
const {
  extractHotTopic,
  HOT_HELP_FEATURE,
  isHotCommand,
} = require("../lib/hot-topics.cjs");
const { createUsageTracker } = require("../lib/usage-tracker.cjs");
const { WeComLongConnection } = require("../lib/wecom-long-connection.cjs");

function makeTempDir() {
  const root = path.join(process.cwd(), "data");
  fs.mkdirSync(root, { recursive: true });
  return fs.mkdtempSync(path.join(root, "test-bridge-"));
}

test("热点命令抽取话题且帮助说明显式启用限制", () => {
  assert.equal(isHotCommand("热点 测试话题"), true);
  assert.equal(isHotCommand("/hot 测试话题"), true);
  assert.equal(isHotCommand("查看热点"), false);
  assert.equal(extractHotTopic("热点 测试话题"), "测试话题");
  assert.equal(extractHotTopic("/hot 测试话题"), "测试话题");
  assert.match(HOT_HELP_FEATURE.usage, /features\.hotTopics\.enabled/);
});

test("Token 用量按高峰价格累计并持久化", () => {
  const dir = makeTempDir();
  try {
    const fixedNow = new Date("2026-10-26T10:30:00+08:00");
    const tracker = createUsageTracker({
      dataRoot: dir,
      nowProvider: () => fixedNow,
    });
    tracker.record({
      input_tokens: 2000,
      cached_input_tokens: 500,
      output_tokens: 1000,
    });
    const entry = tracker.get("2026-10-26");
    assert.equal(entry.calls, 1);
    assert.equal(entry.input, 1500);
    assert.equal(entry.cached, 500);
    assert.equal(entry.output, 1000);
    assert.equal(Number(entry.cost.toFixed(6)), 0.01102);
    assert.match(tracker.format("2026-10-26"), /模型调用：1 次/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = new Map();
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) || [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  emit(name, event = {}) {
    for (const listener of this.listeners.get(name) || []) listener(event);
  }

  send(raw) {
    this.sent.push(JSON.parse(raw));
  }

  open() {
    this.readyState = 1;
    this.emit("open");
  }

  close() {
    this.readyState = 3;
    this.emit("close", { code: 1000, reason: "test" });
  }
}

test("长连接完成订阅认证和 ACK 路由，停止后不重连", async () => {
  FakeWebSocket.instances.length = 0;
  const received = [];
  let authenticated = 0;
  const connection = new WeComLongConnection({
    WebSocketImpl: FakeWebSocket,
    url: "wss://example.invalid",
    botId: "test-bot",
    secret: "test-secret",
    parseFrame: (raw) => JSON.parse(raw),
    onFrame: (frame) => received.push(frame),
    onAuthenticated: () => {
      authenticated += 1;
    },
  });
  connection.start();
  const socket = FakeWebSocket.instances[0];
  socket.open();
  assert.equal(socket.sent[0].cmd, "aibot_subscribe");
  socket.emit("message", {
    data: JSON.stringify({ errcode: 0, errmsg: "ok" }),
  });
  assert.equal(connection.authenticated, true);
  assert.equal(authenticated, 1);

  const ack = connection.send("example_command", { value: 1 });
  const sent = socket.sent.at(-1);
  socket.emit("message", {
    data: JSON.stringify({
      headers: { req_id: sent.headers.req_id },
      errcode: 0,
    }),
  });
  assert.equal((await ack).errcode, 0);
  assert.equal(received.some((frame) => frame.headers?.req_id === sent.headers.req_id), false);

  connection.stop();
  assert.equal(connection.authenticated, false);
  assert.equal(FakeWebSocket.instances.length, 1);
});

test("帮助路由区分命令帮助、功能帮助和普通文本", async () => {
  const replies = [];
  const handle = createHelpRouter({
    features: [{
      aliases: ["状态", "status"],
      usage: "状态帮助",
    }],
    fullHelp: "完整帮助",
    replyText: async (_frame, text) => replies.push(text),
  });
  assert.equal(await handle({}, "/status"), true);
  assert.equal(await handle({}, "有哪些指令"), true);
  assert.equal(await handle({}, "执行普通任务"), false);
  assert.deepEqual(replies, ["状态帮助", "完整帮助"]);
});

test("回答缓存按图片内容生成键并清理过期文件", () => {
  const dir = makeTempDir();
  const images = path.join(dir, "images");
  const qr = path.join(dir, "qr");
  fs.mkdirSync(images, { recursive: true });
  fs.mkdirSync(qr, { recursive: true });
  try {
    const image = path.join(images, "old.png");
    fs.writeFileSync(image, "image");
    const old = new Date(Date.now() - 8 * 24 * 3600 * 1000);
    fs.utimesSync(image, old, old);
    const cache = createAnswerCache({
      dataRoot: dir,
      imageDir: images,
      qrDir: qr,
    });
    const key = cache.key("test", [image]);
    assert.match(key, /^[a-f0-9]{64}$/);
    cache.set(key, "answer");
    assert.equal(cache.get(key).text, "answer");
    const cleanup = cache.cleanup();
    assert.equal(cleanup.removed, 1);
    assert.equal(fs.existsSync(image), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
