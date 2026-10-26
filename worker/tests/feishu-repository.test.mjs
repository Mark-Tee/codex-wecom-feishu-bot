import test from "node:test";
import assert from "node:assert/strict";
import { FeishuTaskRepository, matchTaskRecords } from "../src/legacy/feishu-base/repository.mjs";

const task = {
  recordId: "task-1",
  taskNumber: "WN20261026001",
  location: "测试机房",
  source: "事务工单",
  transactionNo: "SJSW20261026000018",
  roomTicketNo: "JF20261026000027",
  workContent: "故障维修",
  specificWork: "更换光模块",
  workDate: "2026-10-26",
};

test("完全匹配复用，冲突逐项人工确认，无匹配直接创建", () => {
  assert.equal(matchTaskRecords(task, [task]).action, "reuse");
  const conflict = matchTaskRecords(
    { ...task, specificWork: "更换电源" },
    [task],
  );
  assert.equal(conflict.action, "confirm");
  assert.deepEqual(conflict.candidates[0].mismatches, [{
    field: "specificWork",
    label: "具体工作",
    recognized: "更换电源",
    feishu: "更换光模块",
  }]);
  assert.equal(matchTaskRecords(
    { ...task, transactionNo: "SJSW2026102609999", roomTicketNo: "JF2026102609999" },
    [task],
  ).action, "create");
});

test("闭环按任务号汇总机房与非机房扫码", async () => {
  const recordsByTable = {
    task: [{
      record_id: "task-1",
      fields: {
        任务列表: "WN20261026001",
        事务单号: "SJSW20261026000018",
        机房单号: "JF20261026000027",
      },
    }],
    room: [
      {
        record_id: "room-1",
        fields: {
          事务单号: "SJSW20261026000018",
          厂商人员: [{ name: "甲" }],
          进入时间: "2026-10-26T18:00:00+08:00",
          离开时间: "2026-10-26T18:20:00+08:00",
        },
      },
      {
        record_id: "room-2",
        fields: {
          事务单号: "SJSW20261026000018",
          厂商人员: [{ name: "乙" }],
          进入时间: "2026-10-26T18:05:00+08:00",
          离开时间: "2026-10-26T18:15:00+08:00",
        },
      },
    ],
    nonRoom: [{
      record_id: "non-room-1",
      fields: {
        事务单号: "SJSW20261026000018",
        厂商人员: [{ name: "甲" }],
        进入时间: "2026-10-26T18:30:00+08:00",
        离开时间: "2026-10-26T18:40:00+08:00",
      },
    }],
  };
  const repository = new FeishuTaskRepository({
    appToken: "base",
    taskTableId: "task",
    roomScanTableId: "room",
    nonRoomScanTableId: "nonRoom",
    client: {
      listRecords: async ({ tableId }) => recordsByTable[tableId],
    },
  });
  const result = await repository.collectCompletion("WN20261026001");
  assert.equal(result.workload.durationMinutes, 40);
  assert.deepEqual(result.assignees, ["甲", "乙"]);
  assert.deepEqual(result.companions, ["甲", "乙"]);
});
