import test from "node:test";
import assert from "node:assert/strict";
import {
  inferWorkDate,
  peopleNames,
  textValue,
  timestampValue,
  toLogicalCarryOutItem,
  toLogicalFaultyDisk,
  toLogicalScan,
  toLogicalTask,
} from "../src/providers/feishu-base/fields.mjs";

test("飞书复杂字段值转换为统一文本和人员", () => {
  assert.equal(textValue([{ type: "text", text: "更换光模块" }]), "更换光模块");
  assert.deepEqual(
    peopleNames([{ id: "ou_1", name: "甲" }, { id: "ou_2", name: "乙" }]),
    ["甲", "乙"],
  );
  assert.equal(timestampValue(1_790_000_000), new Date(1_790_000_000_000).toISOString());
});

test("物品带出记录解析关联任务、序列号、照片和陪同人", () => {
  const item = toLogicalCarryOutItem({
    record_id: "item-1",
    fields: {
      关联主任务表: [{ record_ids: ["rec-task"], text_arr: ["SJSW001"] }],
      带出地点: "测试机房",
      物品类型: "其他物品",
      物品名称: "光模块",
      厂商: "华为",
      带出人: "张工",
      序列号: " sn 001 ",
      物品照片: [{ file_token: "file-1", name: "module.jpg" }],
      陪同人: "测试甲",
    },
  });
  assert.equal(item.linkedTaskRecordId, "rec-task");
  assert.equal(item.serialNumber, "SN001");
  assert.deepEqual(item.photos, ["file-1"]);
  assert.equal(item.companion, "测试甲");
});

test("故障硬盘记录区分服务器序列号与硬盘SN", () => {
  const disk = toLogicalFaultyDisk({
    record_id: "disk-1",
    fields: {
      关联主任务表: [{ record_ids: ["rec-task"] }],
      所属设备序列号: "SERVER001",
      硬盘SN: "disk 001",
      硬盘尺寸: "2.5",
      硬盘类型: "固态",
      硬盘照片: ["disk-file"],
      登记人: [{ name: "测试甲" }],
    },
  });
  assert.equal(disk.linkedTaskRecordId, "rec-task");
  assert.equal(disk.serverSerialNumber, "SERVER001");
  assert.equal(disk.serialNumber, "DISK001");
  assert.equal(disk.registrar, "测试甲");
  assert.deepEqual(disk.photos, ["disk-file"]);
});

test("主任务记录映射为业务对象并推断日期", () => {
  const task = toLogicalTask({
    record_id: "rec-task",
    fields: {
      任务列表: [{ text: "WN20261026001" }],
      任务地点: "测试机房",
      任务来源: "事务工单",
      事务单号: "SJSW20261026000018",
      机房单号: "JF20261026000027",
      工作内容: "故障维修、更换",
      具体工作事项: "华为停机更换电源",
      指派人员: [{ name: "甲" }],
      陪同人: [{ name: "乙" }],
      状态: "已完成",
    },
  });
  assert.equal(task.taskNumber, "WN20261026001");
  assert.equal(task.workDate, "2026-10-26");
  assert.deepEqual(task.companions, ["乙"]);
});

test("进出记录保留事务单、扫码人员和起止时间", () => {
  const scan = toLogicalScan({
    record_id: "rec-scan",
    fields: {
      事务单号: "SJSW20261026000018",
      厂商人员: "甲、乙",
      机房地点: "测试机房",
      进入时间: 1_790_000_000_000,
      离开时间: 1_790_001_800_000,
    },
  });
  assert.equal(scan.transactionNo, "SJSW20261026000018");
  assert.deepEqual(scan.person, ["甲", "乙"]);
  assert.equal(scan.location, "测试机房");
  assert.equal(inferWorkDate("JF20261026000027"), "2026-10-26");
});
