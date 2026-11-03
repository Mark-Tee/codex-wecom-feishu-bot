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
    diagnostics: {code:"field_fill"},
  }), /飞书浏览器已部分填写/);
  assert.match(formatBrowserFillSummary({configured:true,ok:false,diagnostics:{code:"submit"}}),/失败阶段：submit/);
});

test("write approval block is recognition success and never suggests Tencent completion",()=>{
 const result={configured:true,awaitingWriteApproval:true,requiresLocalReview:true};
 assert.match(formatBrowserFillSummary(result),/识别已完成/);assert.match(formatBrowserFillSummary(result),/未新增记录/);
 const text=formatPendingTasks([{id:"1",status:"ready",browserFill:result}]);assert.match(text,/待本机核准/);assert.doesNotMatch(text,/普通工单确认飞书已提交后发送/);
});

test("success receipt keeps IDs and next action without the filled-field inventory",()=>{
 const text=formatBrowserFillSummary({configured:true,submitted:true,taskNumber:"WD20261104001",filled:["任务列表","指派人员","陪同人"]},{taskId:"10"});
 assert.match(text,/WD20261104001/);assert.match(text,/本地短号：10/);assert.match(text,/发送 \/done 10/);assert.doesNotMatch(text,/已填：|指派人员|陪同人/);assert.ok(text.split("\n").length<=4);
});

test("each write outcome gives a safe next action and concrete local ID", () => {
 const options={taskId:"10"};
 for(const result of [
  {awaitingWriteApproval:true,requiresLocalReview:true},
  {submitted:true,requiresReadback:true},
  {requiresLocalReview:true,message:"相同业务工单已在飞书存在，未新增。请核对原任务：任务甲"},
  {ok:false,filled:["字段甲"]},
 ]) {
  const text=formatBrowserFillSummary({configured:true,...result},options);
  assert.match(text,/下一步：/);assert.match(text,/本地短号：10.*不是飞书单号/);
  assert.doesNotMatch(text,/请核对后补填并手工提交|发送 \/done 10/);
 }
 assert.match(formatBrowserFillSummary({configured:true,submitted:true},options),/下一步：发送 \/done 10/);
 assert.doesNotMatch(formatBrowserFillSummary({configured:true,submitted:true},{...options,testOnly:true}),/下一步：发送 \/done/);
 const pending=formatPendingTasks([{id:"10",status:"ready",browserFill:{requiresLocalReview:true}},{id:"11",status:"ready",browserFill:{submitted:true}}]);
 assert.match(pending,/将短号 10 告知维护者核验/);assert.match(pending,/发送 \/done 11/);
});
