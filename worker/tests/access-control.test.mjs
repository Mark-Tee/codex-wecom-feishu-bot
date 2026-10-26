import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { AccessControl } from "../src/runtime/access-control.mjs";

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

  delete(key) {
    delete this.data[key];
  }
}

async function temporaryRoot(t) {
  const base = process.env.TEMP || ".";
  await fs.mkdir(base, { recursive: true });
  const root = await fs.mkdtemp(path.join(base, "access-control-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

test("启动时用当前有效码覆盖旧配对文件", async (t) => {
  const root = await temporaryRoot(t);
  const expiresAt = Date.now() + 5 * 60 * 1000;
  const state = new MemoryState({ __pairing__: { code: "123456", expiresAt } });
  await fs.writeFile(path.join(root, "pairing-code.txt"), "配对码：999999\n", "utf8");

  const access = new AccessControl({ state, rootDir: root });
  assert.equal(access.ensurePairingCode(), "123456");
  const file = await fs.readFile(path.join(root, "pairing-code.txt"), "utf8");
  assert.match(file, /配对码：123456/);
  assert.match(file, /\/pair 123456/);
  assert.doesNotMatch(file, /999999/);
});

test("已有操作者时删除过期配对文件", async (t) => {
  const root = await temporaryRoot(t);
  const state = new MemoryState({ __operators__: ["user-1"] });
  await fs.writeFile(path.join(root, "pairing-code.txt"), "配对码：999999\n", "utf8");

  const access = new AccessControl({ state, rootDir: root });
  assert.equal(access.ensurePairingCode(), "");
  await assert.rejects(() => fs.access(path.join(root, "pairing-code.txt")));
});

test("邀请码同步写入文件并允许带修饰文本配对", async (t) => {
  const root = await temporaryRoot(t);
  const state = new MemoryState();
  const access = new AccessControl({ state, rootDir: root });
  const code = access.createInvite();

  const file = await fs.readFile(path.join(root, "pairing-code.txt"), "utf8");
  assert.match(file, new RegExp(`配对码：${code}`));

  const result = access.pair("user-1", `配对码：${code}`);
  assert.equal(result.ok, true);
  assert.deepEqual(access.operators(), ["user-1"]);
  await assert.rejects(() => fs.access(path.join(root, "pairing-code.txt")));
});

test("错误码不会删除当前有效码并会重新同步文件", async (t) => {
  const root = await temporaryRoot(t);
  const code = "123456";
  const state = new MemoryState({
    __pairing__: { code, expiresAt: Date.now() + 5 * 60 * 1000 },
  });
  await fs.writeFile(path.join(root, "pairing-code.txt"), "旧文件\n", "utf8");
  const access = new AccessControl({ state, rootDir: root });

  assert.equal(access.pair("user-1", "000000").ok, false);
  const file = await fs.readFile(path.join(root, "pairing-code.txt"), "utf8");
  assert.match(file, new RegExp(code));
});
