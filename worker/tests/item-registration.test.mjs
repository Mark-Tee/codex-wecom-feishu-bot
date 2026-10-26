import test from "node:test";
import assert from "node:assert/strict";
import {
  ITEM_REGISTRY,
  evaluateItemRegistration,
  routeReplacementItem,
} from "../src/core/item-registration.mjs";

const task = {
  recordId: "task-1",
  taskNumber: "WN20261026001",
  location: "测试机房",
  vendor: "华为",
  workDate: "2026-10-26",
};

test("硬盘和光模块进入不同登记表", () => {
  assert.equal(routeReplacementItem({ itemName: "硬盘" }).registry, ITEM_REGISTRY.faultyDisk);
  assert.equal(routeReplacementItem({ itemName: "光模块" }).registry, ITEM_REGISTRY.carryOut);
  assert.equal(routeReplacementItem({ itemName: "服务器整机" }).action, "skip");
});

test("物品带出一物一条，同名称不同序列号分别登记", () => {
  const first = evaluateItemRegistration({
    task,
    item: {
      itemName: "光模块",
      serialNumber: "sn-001",
      carriedBy: "张工",
      photos: ["module-1.jpg"],
    },
    photoSender: "测试甲",
  });
  assert.equal(first.status, "ready");
  assert.equal(first.record.registry, ITEM_REGISTRY.carryOut);
  assert.equal(first.record.companion, "测试甲");
  assert.equal(first.record.vendor, "华为");

  const second = evaluateItemRegistration({
    task,
    item: {
      itemName: "光模块",
      serialNumber: "SN-002",
      carriedBy: "张工",
      photos: ["module-2.jpg"],
    },
    photoSender: "测试甲",
    existingCarryOut: [{
      ...first.record,
      recordId: "item-1",
    }],
  });
  assert.equal(second.status, "ready");
  assert.notEqual(second.identity, first.identity);
});

test("完全相同物品已登记时跳过", () => {
  const existing = {
    recordId: "item-1",
    linkedTaskRecordId: task.recordId,
    itemName: "网卡",
    serialNumber: "NIC001",
  };
  const result = evaluateItemRegistration({
    task,
    item: {
      itemName: "网卡",
      serialNumber: "nic 001",
      carriedBy: "李工",
      photos: ["nic.jpg"],
    },
    photoSender: "测试甲",
    existingCarryOut: [existing],
  });
  assert.equal(result.status, "registered");
  assert.equal(result.existingRecordId, "item-1");
});

test("故障硬盘缺少运维单号和设备序列号时逐项询问", () => {
  const result = evaluateItemRegistration({
    task,
    item: {
      itemName: "硬盘",
      serialNumber: "DISK001",
      brand: "华为",
      diskSize: "2.5",
      diskType: "固态",
      photos: ["disk.jpg"],
    },
    photoSender: "测试甲",
  });
  assert.equal(result.registry, ITEM_REGISTRY.faultyDisk);
  assert.equal(result.status, "needs_input");
  assert.deepEqual(result.missingFields, [
    "运维操作单号",
    "所属设备序列号",
    "所属业务系统",
  ]);
});

test("故障硬盘补全后仍需人工确认", () => {
  const result = evaluateItemRegistration({
    task,
    item: {
      itemName: "硬盘",
      serialNumber: "DISK001",
      serverSerialNumber: "SERVER001",
      businessSystem: "测试系统",
      brand: "华为",
      model: "HSSD",
      diskSize: "2.5",
      diskType: "固态",
      photos: ["disk.jpg"],
    },
    photoSender: "测试甲",
    operationOrderNo: "YWCZ202610260001",
  });
  assert.equal(result.status, "ready");
  assert.equal(result.record.registrar, "测试甲");
  assert.match(result.confirmationText, /硬盘SN：DISK001/);
});
