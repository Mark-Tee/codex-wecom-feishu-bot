import test from "node:test";
import assert from "node:assert/strict";
import { resolveSiteAssignment, applySiteRecordRules } from "../src/core/site-assignment.mjs";
import { classifyRole, findShiftPerson } from "../src/core/duty-role.mjs";
import { ConversationService } from "../src/runtime/conversation-service.mjs";
import { PendingTaskStore } from "../src/runtime/pending-task-store.mjs";
import { toCsv } from "../src/core/draft-merge.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const config = {
  operator_name: "网络甲",
  line: { name: "网络", team_members: ["网络甲", "网络乙"], aux_column_header: "网络辅值" },
  schedule: { sheet_format: "YYYYMM", primary_white_value: "白班", primary_night_value: "夜班", primary_white_fill: "FFFF00", primary_night_fill: "B4C6E7" },
  site_rules: {
    enabled: true, home_site: "站点A", home_site_aliases: ["站点A"], offsite_site: "站点B",
    departments: [
      { name: "系统", members: ["系统甲"], auxiliary_header: "系统辅值", offsite_headers: ["数据中心1", "数据中心2", "数据中心3"], offsite_role: "测试值班" },
      { name: "网络", members: ["网络甲", "网络乙"], auxiliary_header: "网络辅值", offsite_headers: ["网络1", "网络2", "网络3"], offsite_role: "告警值班", attendance_may_start_home_slots: ["网络2", "网络3"] },
    ],
  },
};
const headers = ["日期", "网络甲", "网络乙", "系统甲", "网络辅值", "系统辅值", "数据中心1", "数据中心2", "数据中心3", "网络1", "网络2", "网络3"];
function row(slot = "网络2", operator = "网络甲") {
  const r = ["20261102", "白班", "白班", "白班", "", "", "", "", "", "", "", ""];
  if (slot) r[headers.indexOf(slot)] = operator;
  return r;
}
const styles = [{ col: 1, background_color: "FFFF00" }, { col: 2, background_color: "FFFF00" }];
const assignment = () => resolveSiteAssignment({ row: row(), headers, config });

test("两部门岗位分别映射培训职责，外派覆盖本地黄色白班", () => {
  const role = classifyRole({ row: row(), headers, styles, config });
  assert.equal(role.role, "offsite_training");
  assert.equal(role.assignment.site, "站点B");
  assert.equal(role.assignment.assignmentType, "告警值班");
  const system = resolveSiteAssignment({ row: row("数据中心1", "系统甲"), headers, config, operator: "系统甲" });
  assert.equal(system.department, "系统");
  assert.equal(system.assignmentType, "测试值班");
});

test("辅助岗位按所属部门列判断，本地主值不会选中外派人员", () => {
  const r = row(null); r[5] = "系统甲";
  const role = classifyRole({ row: r, headers, styles: [], config: { ...config, operator_name: "系统甲" } });
  assert.equal(role.role, "white_auxiliary");
  assert.equal(findShiftPerson({ row: row(), headers, styles, config, shift: "white", auxiliaryHeader: "网络辅值" }), "网络乙");
});

test("网络2/3打卡可能性不改变工作地点，不把概率当作事实", () => {
  for (const slot of ["网络1", "网络2", "网络3"]) {
    const result = resolveSiteAssignment({ row: row(slot), headers, config });
    assert.equal(result.site, "站点B");
    assert.equal(result.attendanceIsNotWorkLocation, true);
    assert.equal(result.attendanceMayStartHome, slot !== "网络1");
  }
});

test("缺岗位列、重复岗位、跨部门岗位冲突必须停止", () => {
  assert.throws(() => resolveSiteAssignment({ row: row(), headers: headers.slice(0, -1), config }), /缺少/);
  const r = row(); r[headers.indexOf("网络3")] = "网络甲";
  assert.throws(() => resolveSiteAssignment({ row: r, headers, config }), /重复/);
  assert.throws(() => resolveSiteAssignment({ row: row("数据中心1"), headers, config }), /部门冲突/);
});

function weekly(title = "更换部件") {
  return [1, "站点A", "其他临时工作", title, "否", "11.2", "1h", "示例需求", "示例发布", "网络甲", "否", "否", "09:00", "10:00", "已完成", "无", "1时00分"];
}
const context = () => ({ shiftDate: "20261102", schedule: [{ date: "20261102", role: { role: "offsite_training", assignment: assignment() } }] });
const card = (location = "站点B") => ({ location, source: "事务工单", transactionNo: "SJSW20261102000001", roomTicketNo: "JF20261102000001", workContent: "故障维修", specificWork: "更换部件", expectedEnterAt: "2026-11-02 09:00" });

test("外派默认记录全部移除；明确本地实际工单只留该条周报，不生成交接", () => {
  const spec = { weeklyRows: [weekly()], handoverRows: [["模型自动生成的交接"]] };
  const result = applySiteRecordRules(spec, { context: context(), fillCard: card(), config });
  assert.deepEqual(result.spec, { weeklyRows: [], handoverRows: [] });
  assert.equal(result.skipHomeDraft, true);
  const local = applySiteRecordRules(spec, { context: context(), fillCard: card("站点A"), config });
  assert.deepEqual(local.spec.weeklyRows, [weekly()]);
  assert.deepEqual(local.spec.handoverRows, []);
  assert.equal(local.skipHomeDraft, false);
  const actualInspection = applySiteRecordRules({ weeklyRows: [weekly("机房巡检")], handoverRows: [] }, {
    context: context(), fillCard: { ...card("站点A"), specificWork: "机房巡检" }, config,
  });
  assert.equal(actualInspection.spec.weeklyRows.length, 1);
  // A default weekly location alone is not evidence of an actual home-site ticket.
  assert.equal(applySiteRecordRules(spec, { context: context(), fillCard: {}, config }).skipHomeDraft, true);
});

test("明确本地工单也不能夹带巡检、通报或多条默认记录", () => {
  for (const weeklyRows of [[weekly("网络通报")], [weekly("日常机房巡检")], [weekly(), weekly("网络通报")]]) {
    assert.throws(() => applySiteRecordRules({ weeklyRows, handoverRows: [] }, { context: context(), fillCard: card("站点A"), config }), /只登记/);
  }
});

test("未安排异地不等于已在本地工作，保留原有周报交接规则", () => {
  assert.equal(resolveSiteAssignment({ row: row(null), headers, config }).site, "");
  const spec = { weeklyRows: [weekly()], handoverRows: [] };
  assert.equal(applySiteRecordRules(spec, { context: { schedule: [], shiftDate: "20261102" }, fillCard: card(), config }).spec, spec);
});

test("端到端外派工单只建飞书，误发/done不会写本地工作草稿", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "site-assignment-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const store = {};
  const state = { get: (k, fallback) => structuredClone(store[k] ?? fallback), set: (k, v) => { store[k] = structuredClone(v); } };
  const pendingTasks = new PendingTaskStore(state);
  let writes = 0;
  const replies = [];
  const dutyConfig = { ...config, sources: { mode: "online", online: { schedule: { file_url: "schedule" }, weekly: { file_url: "weekly" }, handover: { file_url: "handover" } } }, weekly: { sheet_format: "M月" }, handover: { sheet_format: "YYYYMM", inspection_text: "日常机房巡检" }, defaults: {} };
  const data = { schedule: [headers, row()], weekly: [Array(17).fill("")], handover: [Array(9).fill("")] };
  const service = new ConversationService({
    config: { duty: { enabled: true, defaultOperator: "网络甲", workflowMode: "direct-draft" }, runtime: { specRoot: dir }, feishuBrowser: { autoFill: true, autoSubmit: true } },
    dutyConfig, pendingTasks, state, access: { isAuthorized: () => true }, logger: { info() {}, error() {} },
    docsClient: {
      getSheetInfo: async (file) => ({ sheets: [{ sheet_name: file.file_url === "weekly" ? "11月" : "202611", sheet_id: file.file_url, row_count: data[file.file_url].length, col_count: data[file.file_url][0].length }] }),
      getCsv: async (file) => ({ csv_data: toCsv(data[file.file_url]) }), getStyles: async () => ({ cells: [] }),
    },
    runner: { run: async () => ({ ok: true, text: JSON.stringify({ fillCard: card(), weeklyRows: [weekly("网络通报")], handoverRows: [] }) }) },
    draftRepository: { update: async () => { writes += 1; throw new Error("不允许写入"); } },
    browserFiller: { enabled: true, fill: async (task) => {
      assert.equal(task.workflowMode, "offsite-feishu");
      return { configured: true, submitted: true, verification: { ok: true }, taskNumber: "WD20261102001" };
    } },
  });
  const responder = { replyText: async (s) => replies.push(s), replyProgress: async (_id, s) => replies.push(s) };
  const handle = async (text) => {
    await service.handle({ text, receivedAt: "2026-11-02T10:00:00+08:00", chatId: "test", userId: "test", images: [] }, responder);
    const until = Date.now() + 1000;
    while (service.queue.running || service.queue.size) {
      if (Date.now() > until) throw new Error("任务等待超时");
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  await handle("工单 2026-11-02 09:00");
  await handle("/done 1");
  assert.equal(writes, 0);
  assert.ok(replies.some((s) => s.includes("无需 /done")));
  assert.equal(pendingTasks.find("1", "test").status, "completed");
});
