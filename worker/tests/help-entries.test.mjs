import test from "node:test";
import assert from "node:assert/strict";
import { formatHelpText, HELP_ENTRIES } from "../src/runtime/help-entries.mjs";

test("帮助条目包含参数、示例和限制", () => {
  assert.ok(HELP_ENTRIES.length >= 10);
  for (const entry of HELP_ENTRIES) {
    assert.equal(typeof entry.trigger, "string");
    assert.equal(typeof entry.parameters, "string");
    assert.ok(entry.description);
    assert.ok(entry.example);
    assert.ok(entry.limits);
  }
});

test("帮助文本覆盖半自动闭环命令", () => {
  const text = formatHelpText();
  assert.match(text, /\/done <短号>/);
  assert.match(text, /\/pending/);
  assert.match(text, /\/cancel <短号>/);
  assert.match(text, /示例：\/done 12/);
  assert.match(text, /普通值班两个人员字段使用当前使用人/);
  assert.match(text, /动力值班继续留空/);
  assert.match(text, /每天08:20刷新/);
  assert.match(text, /收到工单的北京时间班次/);
  assert.match(text, /白班 WD、夜班 WN/);
  assert.match(text, /任务列表号后三位/);
  assert.match(text, /字段缺失时会尝试自动发现/);
  assert.match(text, /诊断截图/);
});
