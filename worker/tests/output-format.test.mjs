import test from "node:test";
import assert from "node:assert/strict";
import {
  formatBrowserFillSummary,
  formatPendingTasks,
  formatStatus,
} from "../src/runtime/output-format.mjs";

test("待办和状态文本保持原有信息", () => {
  assert.match(formatPendingTasks([]), /没有未完成/);
  const pending = formatPendingTasks([{
    id: "3",
    status: "ready",
    operator: "测试甲",
    browserFill: { ok: true },
  }]);
  assert.match(pending, /3 · 待飞书提交 · 测试甲 · 浏览器已填/);

  const status = formatStatus({
    startedAt: 1_000,
    now: 61_000,
    queueSize: 2,
    queueRunning: true,
    operator: "测试甲",
    workflowMode: "manual-feishu",
    browserEnabled: true,
    pendingCount: 4,
  });
  assert.match(status, /运行：60 秒/);
  assert.match(status, /队列：2 个/);
  assert.match(status, /本地待办：4 个/);
});

test("浏览器结果摘要区分提交、待核验和失败", () => {
  assert.match(formatBrowserFillSummary({
    configured: true,
    submitted: true,
    taskNumber: "WN20261026008",
    filled: ["任务列表"],
  }), /飞书已自动核对并提交/);
  assert.match(formatBrowserFillSummary({
    configured: true,
    ok: true,
    filled: ["任务列表"],
  }, { autoSubmit: false }), /请核对后手工点击提交/);
  assert.match(formatBrowserFillSummary({
    configured: true,
    ok: false,
    filled: ["任务列表"],
    skipped: ["陪同人（人员不存在）"],
  }), /飞书浏览器已部分填写/);
});
