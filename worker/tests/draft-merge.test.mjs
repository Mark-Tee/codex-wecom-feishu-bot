import test from "node:test";
import assert from "node:assert/strict";
import { mergeDraftRows, parseCsv, toCsv } from "../src/core/draft-merge.mjs";

const weeklyHeader = ["序号", "工作地", "任务类型", "任务描述", "紧急", "日期", "预计耗时", "需求人", "发布人", "责任人", "周期任务", "加班", "开始", "结束", "反馈", "问题", "实际"];
const handoverHeader = ["日期", "条线", "班次", "交班人", "完成", "未完成", "接班人", "说明", "闭环"];

test("CSV 保留单元格内换行", () => {
  const rows = [["a", "1、巡检\n2、换盘"], ["b", "x"]];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});

test("保留当前和上一实际班次，淘汰更早班次", () => {
  const weeklyExisting = [
    weeklyHeader,
    [141, "测试机房", "其他", "旧任务", "否", "10.21", "1h", "动力值班", "动力值班", "张明", "否", "否", "9:00", "10:00", "已完成", "无", "1时00分"],
    [142, "测试机房", "其他", "上一班任务", "否", "10.22", "1h", "动力值班", "动力值班", "张明", "否", "否", "9:00", "10:00", "已完成", "无", "1时00分"],
  ];
  const handoverExisting = [
    handoverHeader,
    ["20261022", "网络", "白班", "张明", "1、日常机房巡检", "无", "王爽", "", ""],
  ];
  const merged = mergeDraftRows({
    weeklyExisting,
    handoverExisting,
    weeklyIncoming: [[143, "测试机房", "其他", "新任务", "否", "10.24", "1h", "动力值班", "动力值班", "张明", "否", "否", "9:00", "10:00", "已完成", "无", "1时00分"]],
    handoverIncoming: [["20261024", "网络", "夜班", "张明", "1、日常机房巡检\n2、新任务", "无", "李俊", "", ""]],
    currentDate: "20261024",
    previousDate: "20261022",
    year: "2026",
  });
  assert.deepEqual(merged.weeklyRows.map((row) => row[5]), ["10.22", "10.24"]);
  assert.deepEqual(merged.handoverRows.map((row) => row[0]), ["20261022", "20261024"]);
});

test("序号冲突时自动递增", () => {
  const merged = mergeDraftRows({
    weeklyExisting: [weeklyHeader, [143, "测试机房", "其他", "旧", "否", "10.23", "1h", "", "", "张明", "否", "否", "9:00", "10:00", "已完成", "无", "1时00分"]],
    handoverExisting: [handoverHeader],
    weeklyIncoming: [[143, "测试机房", "其他", "新", "否", "10.24", "1h", "", "", "张明", "否", "否", "9:00", "10:00", "已完成", "无", "1时00分"]],
    handoverIncoming: [],
    currentDate: "20261024",
    previousDate: "20261023",
    year: "2026",
  });
  assert.equal(merged.weeklyRows.at(-1)[0], "144");
});
