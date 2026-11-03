import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDutySpec, validateDutySpec } from "../src/core/duty-spec.mjs";
import {buildDutyPrompt} from "../src/core/duty-prompt.mjs";

test("历史模板规则保留小数预计耗时和特殊来源确认，禁止自动覆盖正式表", () => {
  const prompt = buildDutyPrompt({context: {}, userText: "测试", receivedAt: "2026-11-03T09:00:00+08:00"});
  assert.match(prompt, /允许0.5h、1.5h，不向上取整/);
  assert.match(prompt, /特殊需求来源时必须先询问/);
  assert.match(prompt, /正式在线周报和交接表不自动修改/);
  assert.doesNotMatch(prompt, /交接班标题必须写“姓名/);
});

test("周报与交接按历史模板简写，本人姓名保留在交班人列", () => {
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
  assert.equal(normalized.handoverRows[0][4], "1、日常机房巡检\n2、更换光模块");
  assert.equal(normalized.weeklyRows[0][12], "09:00");
  assert.doesNotThrow(() => validateDutySpec(normalized));
});

test("保留机房位置、小数预计耗时；同班次合并去重，人员不同不合并", () => {
  const weekly = Array(17).fill(""); weekly[3] = "A1-202 陪同使用人更换光模块"; weekly[6] = "0.5h";
  const normalized = normalizeDutySpec({weeklyRows: [weekly], handoverRows: [
    ["20261103", "网络", "白班", "测试甲", "1、巡检\n2、更换光模块", "无", "测试乙", "", ""],
    ["20261103", "网络", "白班", "测试甲", "1、更换光模块\n2、陪同使用人查看链路", "", "测试乙", "", ""],
    ["20261103", "网络", "白班", "测试丙", "巡检", "", "测试乙", "", ""],
  ]}, "测试甲");
  assert.equal(normalized.weeklyRows[0][3], "A1-202 更换光模块");
  assert.equal(normalized.weeklyRows[0][6], "0.5h");
  assert.equal(normalized.handoverRows.length, 2);
  assert.equal(normalized.handoverRows[0][4], "1、巡检\n2、更换光模块\n3、查看链路");
});

test("列数错误会被拒绝", () => {
  assert.throws(
    () => validateDutySpec({ weeklyRows: [[1, 2]], handoverRows: [] }),
    /17 个值/,
  );
});
