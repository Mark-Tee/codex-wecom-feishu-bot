import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDutySpec, validateDutySpec } from "../src/core/duty-spec.mjs";

test("周报清除陪同使用人，交接班补操作人", () => {
  const normalized = normalizeDutySpec({
    weeklyRows: [[
      143, "测试机房", "其他临时工作", "陪同使用人更换光模块", "是", "10.23",
      "2h", "网络一线", "网络一线", "张明", "否", "否", "9:00", "11:00",
      "已完成", "无", "2时00分",
    ]],
    handoverRows: [[
      "20261023", "网络", "夜班", "张明",
      "1、日常机房巡检\n2、更换光模块", "无", "王爽", "", "",
    ]],
  }, "张明");
  assert.equal(normalized.weeklyRows[0][3], "更换光模块");
  assert.match(normalized.handoverRows[0][4], /张明更换光模块/);
  assert.equal(normalized.weeklyRows[0][12], "09:00");
  assert.doesNotThrow(() => validateDutySpec(normalized));
});

test("列数错误会被拒绝", () => {
  assert.throws(
    () => validateDutySpec({ weeklyRows: [[1, 2]], handoverRows: [] }),
    /17 个值/,
  );
});
