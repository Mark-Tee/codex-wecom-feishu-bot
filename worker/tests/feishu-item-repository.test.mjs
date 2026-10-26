import test from "node:test";
import assert from "node:assert/strict";
import { ITEM_REGISTRY } from "../src/core/item-registration.mjs";
import { FeishuItemRepository } from "../src/providers/feishu-base/item-repository.mjs";

test("并发读取两张物品表并只比较当前主任务", async () => {
  const records = {
    carry: [
      {
        record_id: "item-current",
        fields: {
          关联主任务表: [{ record_ids: ["task-1"] }],
          物品名称: "光模块",
          序列号: "SN001",
        },
      },
      {
        record_id: "item-other",
        fields: {
          关联主任务表: [{ record_ids: ["task-other"] }],
          物品名称: "网卡",
          序列号: "NIC001",
        },
      },
    ],
    disk: [],
  };
  const calls = [];
  const repository = new FeishuItemRepository({
    appToken: "base",
    carryOutTableId: "carry",
    faultyDiskTableId: "disk",
    client: {
      listRecords: async ({ tableId }) => {
        calls.push(tableId);
        return records[tableId] || [];
      },
    },
  });
  const results = await repository.inspectTask({
    task: {
      recordId: "task-1",
      taskNumber: "WN20261026001",
      location: "测试机房",
      vendor: "华为",
    },
    items: [{
      itemName: "光模块",
      serialNumber: "sn 001",
      carriedBy: "张工",
      photos: ["module.jpg"],
    }],
    photoSender: "测试甲",
  });
  assert.deepEqual(calls.sort(), ["carry", "disk"]);
  assert.equal(results[0].status, "registered");
  assert.equal(results[0].registry, ITEM_REGISTRY.carryOut);
});
