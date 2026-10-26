import test from "node:test";
import assert from "node:assert/strict";
import { assertPlatformAdapter } from "../src/platforms/platform-contract.mjs";

test("完整平台适配器通过契约校验", () => {
  assert.doesNotThrow(() => assertPlatformAdapter({
    start() {},
    stop() {},
    handle() {},
    sendText() {},
    sendProgress() {},
  }));
});

test("缺少平台方法会报错", () => {
  assert.throws(
    () => assertPlatformAdapter({ start() {} }),
    /缺少方法/,
  );
});
