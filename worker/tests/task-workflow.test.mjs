import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateScanWorkload,
  chooseAssignee,
  compareTaskIdentity,
  nextTaskNumber,
  parseExpectedEnterAt,
  parseTaskNumber,
  resolveTaskShift,
  resolveTaskShiftForWorkOrder,
  taskNumberToShortId,
} from "../src/core/task-workflow.mjs";

test("夜班任务号使用夜班开始日期", () => {
  assert.equal(
    resolveTaskShift("2026-10-27T08:29:59+08:00").prefix,
    "WN20261026",
  );
  assert.equal(
    resolveTaskShift("2026-10-27T08:30:00+08:00").prefix,
    "WD20261027",
  );
  assert.equal(
    resolveTaskShift("2026-10-26T17:30:00+08:00").prefix,
    "WN20261026",
  );
});

test("任务号按同前缀最大序号递增", () => {
  assert.equal(parseTaskNumber("WN20261026999").sequence, 999);
  assert.equal(
    nextTaskNumber(
      ["WN20261026001", "WD20261026008", "WN20261026004"],
      "WN20261026",
    ),
    "WN20261026005",
  );
});

test("本地短号使用任务列表后三位且去掉前导零", () => {
  assert.equal(taskNumberToShortId("WN20261026006"), "6");
  assert.equal(taskNumberToShortId("WD20261026012"), "12");
  assert.equal(taskNumberToShortId("WN20261026123"), "123");
  assert.equal(taskNumberToShortId("invalid"), "");
});

test("任务列表号按预计进入时间采用白班或夜班前缀", () => {
  assert.equal(
    resolveTaskShiftForWorkOrder({ expectedEnterAt: "2026/10/26 09:00" }).prefix,
    "WD20261026",
  );
  assert.equal(
    resolveTaskShiftForWorkOrder({ expectedEnterAt: "2026/10/26 20:50" }).prefix,
    "WN20261026",
  );
  assert.equal(
    resolveTaskShiftForWorkOrder({ expectedEnterAt: "2026/10/27 07:00" }).prefix,
    "WN20261026",
  );
});

test("预计进入时间拒绝不存在的日期", () => {
  assert.deepEqual(parseExpectedEnterAt("2026/10/26 20:50"), {
    iso: "2026-10-26T20:50:00+08:00",
    date: "2026/10/26",
    time: "20:50",
  });
  assert.equal(parseExpectedEnterAt("2026/02/30 20:50"), null);
  assert.equal(parseExpectedEnterAt("2026/10/26 24:00"), null);
});

test("工单识别值与飞书值逐项比较", () => {
  const result = compareTaskIdentity(
    {
      transactionNo: "sjsw 20261026000001",
      roomTicketNo: "JF20261026000001",
      workDate: "2026/10/26",
      specificWork: "更换光模块",
    },
    {
      transactionNo: "SJSW20261026000001",
      roomTicketNo: "JF20261026000001",
      workDate: "2026-10-26",
      specificWork: "更换电源",
    },
  );
  assert.equal(result.exact, false);
  assert.deepEqual(result.mismatches, [{
    field: "specificWork",
    label: "具体工作",
    recognized: "更换光模块",
    feishu: "更换电源",
  }]);
});

test("同一人多段扫码分别求和且 25 分钟只加一次", () => {
  const result = calculateScanWorkload([
    {
      person: "甲",
      enteredAt: "2026-10-26T18:00:00+08:00",
      leftAt: "2026-10-26T18:10:00+08:00",
      source: "机房内",
    },
    {
      person: "甲",
      enteredAt: "2026-10-26T18:30:00+08:00",
      leftAt: "2026-10-26T18:50:00+08:00",
      source: "非机房",
    },
    {
      person: "乙",
      enteredAt: "2026-10-26T18:05:00+08:00",
      leftAt: "2026-10-26T18:25:00+08:00",
      source: "机房内",
    },
  ]);
  assert.equal(result.durationMinutes, 50);
  assert.equal(result.bufferedDurationMinutes, 75);
  assert.deepEqual(
    result.people.map((item) => [item.person, item.workloadMinutes]),
    [["甲", 55], ["乙", 45]],
  );
});

test("单人选派取最早进入的人", () => {
  const records = [
    { person: "甲", enteredAt: "2026-10-26T18:10:00+08:00" },
    { person: "乙", enteredAt: "2026-10-26T18:05:00+08:00" },
  ];
  assert.deepEqual(chooseAssignee(records), ["乙"]);
  assert.deepEqual(chooseAssignee(records, { allowMultiple: true }), ["乙", "甲"]);
});
