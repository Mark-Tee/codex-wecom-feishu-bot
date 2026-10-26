import test from "node:test";
import assert from "node:assert/strict";
import {
  formatFillCard,
  inferFillCardFromSpec,
  normalizeFillCard,
} from "../src/core/fill-card.mjs";

test("填报卡字段规范化并保留多值", () => {
  const card = normalizeFillCard({
    location: "南区机房",
    workContent: ["故障维修", "更换"],
    transactionNo: " SJSW001 ",
  });
  assert.deepEqual(card, {
    location: "南区机房",
    source: "",
    transactionNo: "SJSW001",
    roomTicketNo: "",
    workContent: "故障维修、更换",
    specificWork: "",
    expectedEnterAt: "",
    vendor: "",
  });
});

test("缺少填报字段时从内部草稿推断基础值", () => {
  const card = inferFillCardFromSpec({
    weeklyRows: [[
      1, "南区机房", "其他临时工作", "更换光模块", "否", "10.26",
      "1h", "网络一线", "网络一线", "测试甲", "否", "否", "09:00", "10:00",
      "已完成", "无", "1时00分",
    ]],
    handoverRows: [],
  });
  assert.equal(card.location, "南区机房");
  assert.equal(card.specificWork, "更换光模块");
  assert.equal(card.expectedEnterAt, "10.26 09:00");
});

test("填报卡输出短号、未识别提示和 done 命令", () => {
  const text = formatFillCard({
    id: "42",
    fillCard: { transactionNo: "SJSW001" },
  });
  assert.match(text, /飞书填报卡 · 42/);
  assert.match(text, /事务单号：SJSW001/);
  assert.match(text, /任务地点：未识别，请查看原图/);
  assert.match(text, /\/done 42/);
});

test("自动提交模式在填报卡中说明由机器人提交", () => {
  const text = formatFillCard({
    id: "43",
    fillCard: { transactionNo: "SJSW002" },
  }, { autoSubmit: true });
  assert.match(text, /机器人会核对.*自动提交飞书/);
});
