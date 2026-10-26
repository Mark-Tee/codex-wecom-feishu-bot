import test from "node:test";
import assert from "node:assert/strict";
import { requestId } from "../src/request-id.mjs";
import { MAX_REPLY_BYTES, truncateReply } from "../src/reply-text.mjs";
import { extractDutyJson } from "../src/runtime/duty-output.mjs";

test("请求 ID 带前缀且不重复", () => {
  const first = requestId("task");
  const second = requestId("task");
  assert.match(first, /^task_[0-9a-f-]{36}$/);
  assert.notEqual(first, second);
});

test("平台回复超过上限时截断", () => {
  const source = "中".repeat(MAX_REPLY_BYTES);
  const result = truncateReply(source);
  assert.ok(Buffer.byteLength(result, "utf8") <= MAX_REPLY_BYTES + 40);
  assert.match(result, /内容过长，已截断/);
  assert.equal(truncateReply("正常回复"), "正常回复");
});

test("只提取符合值班草稿结构的最后一个 JSON", () => {
  const text = [
    '忽略 {"weeklyRows": {}, "handoverRows": []}',
    '错误 {"weeklyRows": [["旧"]], "handoverRows": []}',
    '正确 {"weeklyRows": [["新"]], "handoverRows": []}',
  ].join("\n");
  assert.deepEqual(extractDutyJson(text), {
    weeklyRows: [["新"]],
    handoverRows: [],
  });
  assert.deepEqual(extractDutyJson('{"needsClarification":"缺少日期"}'), {
    needsClarification: "缺少日期",
  });
});
