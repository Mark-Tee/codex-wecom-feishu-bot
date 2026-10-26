import test from "node:test";
import assert from "node:assert/strict";
import { FeishuTaskCreationService } from "../src/legacy/feishu-base/task-service.mjs";

function field(name, type) {
  return { field_name: name, type };
}

function createClient(initialRecords = []) {
  const records = [...initialRecords];
  const calls = { tokens: 0, fields: 0, lists: 0, creates: 0, filters: [] };
  return {
    records,
    calls,
    async warmToken() {
      calls.tokens += 1;
      return "token";
    },
    async listFields() {
      calls.fields += 1;
      return [
        field("任务列表", 1),
        field("任务地点", 3),
        field("任务来源", 3),
        field("事务单号", 1),
        field("机房单号", 1),
        field("工作内容", 4),
        field("具体工作事项", 1),
        field("预计进入时间", 5),
      ];
    },
    async listRecords(options) {
      calls.lists += 1;
      calls.filters.push(options.filter);
      return structuredClone(records);
    },
    async createRecord(_table, fields) {
      calls.creates += 1;
      const record = {
        record_id: `record-${calls.creates}`,
        fields: structuredClone(fields),
      };
      records.push(record);
      return structuredClone(record);
    },
  };
}

function order(suffix) {
  return {
    location: "测试机房",
    source: "事务工单",
    transactionNo: `SJSW20261026${suffix}`,
    roomTicketNo: `JF20261026${suffix}`,
    workContent: "故障维修、更换",
    specificWork: "更换光模块",
    expectedEnterAt: "2026-10-26T18:10:00+08:00",
  };
}

test("启动预热只取一次令牌和字段，建单走一次查重加一次创建", async () => {
  const client = createClient();
  const service = new FeishuTaskCreationService({
    client,
    appToken: "base",
    taskTableId: "tasks",
    clock: () => performance.now(),
  });
  await Promise.all([service.warm(), service.warm()]);
  const result = await service.createOrReuse(order("000018"), {
    receivedAt: "2026-10-26T20:00:00+08:00",
  });
  assert.equal(result.action, "create");
  assert.equal(result.taskNumber, "WN20261026001");
  assert.deepEqual(
    {
      tokens: client.calls.tokens,
      fields: client.calls.fields,
      lists: client.calls.lists,
      creates: client.calls.creates,
    },
    { tokens: 1, fields: 1, lists: 1, creates: 1 },
  );
  assert.deepEqual(client.calls.filters[0], {
    conjunction: "or",
    conditions: [
      {
        field_name: "任务列表",
        operator: "contains",
        value: ["WN20261026"],
      },
      {
        field_name: "事务单号",
        operator: "is",
        value: ["SJSW20261026000018"],
      },
      {
        field_name: "机房单号",
        operator: "is",
        value: ["JF20261026000018"],
      },
    ],
  });
  assert.deepEqual(client.records[0].fields.工作内容, ["故障维修", "更换"]);
  assert.equal(typeof client.records[0].fields.预计进入时间, "number");
});

test("同班次并发创建串行重查，任务号不重复", async () => {
  const client = createClient();
  const service = new FeishuTaskCreationService({
    client,
    appToken: "base",
    taskTableId: "tasks",
  });
  const [first, second] = await Promise.all([
    service.createOrReuse(order("000018"), { receivedAt: "2026-10-26T20:00:00+08:00" }),
    service.createOrReuse(order("000019"), { receivedAt: "2026-10-26T20:01:00+08:00" }),
  ]);
  assert.deepEqual(
    [first.taskNumber, second.taskNumber].sort(),
    ["WN20261026001", "WN20261026002"],
  );
  assert.equal(new Set([first.taskNumber, second.taskNumber]).size, 2);
  assert.deepEqual(
    {
      tokens: client.calls.tokens,
      fields: client.calls.fields,
      lists: client.calls.lists,
      creates: client.calls.creates,
    },
    { tokens: 1, fields: 1, lists: 2, creates: 2 },
  );
});

test("同事已建好的完全匹配任务直接复用", async () => {
  const recognized = order("000018");
  const client = createClient([{
    record_id: "existing",
    fields: {
      任务列表: "WN20261026001",
      任务地点: recognized.location,
      任务来源: recognized.source,
      事务单号: recognized.transactionNo,
      机房单号: recognized.roomTicketNo,
      工作内容: ["故障维修", "更换"],
      具体工作事项: recognized.specificWork,
    },
  }]);
  const service = new FeishuTaskCreationService({
    client,
    appToken: "base",
    taskTableId: "tasks",
  });
  const result = await service.createOrReuse(recognized, {
    receivedAt: "2026-10-26T20:00:00+08:00",
  });
  assert.equal(result.action, "reuse");
  assert.equal(result.task.recordId, "existing");
  assert.equal(client.calls.creates, 0);
});
