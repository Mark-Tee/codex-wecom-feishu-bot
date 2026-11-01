import test from "node:test";
import assert from "node:assert/strict";
import { powerDutyFromRows, readPowerRoster } from "../src/providers/tencent-docs/power-roster.mjs";
import { ConversationService } from "../src/runtime/conversation-service.mjs";
import { PendingTaskStore } from "../src/runtime/pending-task-store.mjs";
import { resolvePersonFields, emptyPersonMismatches } from "../src/platforms/feishu-browser/field-options.mjs";

const headers = ["日期", "动力白班值班人员", "动力夜班值班人员"];
const rows = [headers, ["20261031", "乙", "甲"], ["20261101", "甲", "乙"]];

test("动力班次按收单北京时间判断，凌晨跨月用前日夜班", () => {
  const role = (receivedAt, operator = "甲") => powerDutyFromRows(rows, { receivedAt, operator });
  assert.deepEqual(role("2026-11-01T08:29:59+08:00"), { matched: true, date: "20261031", kind: "夜班" });
  assert.deepEqual(role("2026-11-01T08:30:00+08:00"), { matched: true, date: "20261101", kind: "白班" });
  assert.equal(role("2026-11-01T17:29:59+08:00").matched, true);
  assert.equal(role("2026-11-01T17:30:00+08:00").matched, false);
  assert.equal(role("2026-11-01T00:30:00Z").kind, "白班");
});

test("姓名精确匹配；缺列、缺日期、重复日期和空人员均拒绝猜测", () => {
  const args = { receivedAt: "2026-11-01T10:00:00+08:00", operator: "甲" };
  assert.equal(powerDutyFromRows([headers, ["20261101", "甲乙、丙", "乙"]], args).matched, false);
  for (const bad of [[[]], [headers], [...rows, rows[2]], [headers, ["20261101", "", "乙"]]]) {
    assert.throws(() => powerDutyFromRows(bad, args));
  }
});

test("动力模式忽略模型提供的人员，并验证字段存在且为空", () => {
  assert.deepEqual(resolvePersonFields({ workflowMode: "power-duty", operator: "甲" }), { assignees: "", companions: "", leaveEmpty: true });
  assert.deepEqual(resolvePersonFields({ operator: "甲" }), { assignees: "甲", companions: "甲" });
  const actual = { assignees: { exists: true, selectedText: "" }, companions: { exists: true, selectedText: "" } };
  assert.deepEqual(emptyPersonMismatches(actual), []);
  actual.assignees.selectedText = "默认人员";
  assert.deepEqual(emptyPersonMismatches(actual), ["指派人员必须留空"]);
  assert.equal(emptyPersonMismatches({}).length, 2);
});

test("在线排班每次读取最新值，失败不降级为旧缓存", async () => {
  let data = [headers, ["20261101", "甲", "乙"]];
  let reads = 0;
  const args = {
    config: { sources: { mode: "online", online: { schedule: {} } } },
    receivedAt: "2026-11-01T10:00:00+08:00", operator: "甲",
    client: {
      getSheetInfo: async () => ({ sheets: [{ sheet_name: "202611", sheet_id: "s", row_count: 2, col_count: 3 }] }),
      getCsv: async () => { reads += 1; return { csv_data: data.map((row) => row.join(",")).join("\n") }; },
    },
  };
  assert.equal((await readPowerRoster(args)).matched, true);
  data[1][1] = "乙";
  assert.equal((await readPowerRoster(args)).matched, false);
  assert.equal(reads, 2);
  args.client.getCsv = async () => { throw new Error("read failed"); };
  await assert.rejects(readPowerRoster(args), /read failed/);
});

function setup({ submitted = true, readFails = false } = {}) {
  const data = {};
  const state = { get: (key, fallback) => structuredClone(data[key] ?? fallback), set: (key, value) => { data[key] = structuredClone(value); } };
  const pendingTasks = new PendingTaskStore(state);
  const replies = [];
  const calls = { tables: [], model: 0, fill: [], drafts: 0 };
  const config = {
    duty: { enabled: true, defaultOperator: "甲", workflowMode: "direct-draft", powerDuty: { enabled: true } },
    runtime: {}, feishuBrowser: { autoFill: true, autoSubmit: true },
  };
  let onDuty = "甲";
  const docsClient = {
    getSheetInfo: async (file) => {
      calls.tables.push(file.file_url);
      assert.equal(file.file_url, "schedule");
      if (readFails) throw new Error("排班离线");
      return { sheets: [{ sheet_name: "202611", sheet_id: "s", row_count: 2, col_count: 3 }] };
    },
    getCsv: async () => ({ csv_data: [headers, ["20261101", onDuty, "乙"]].map((r) => r.join(",")).join("\n") }),
  };
  const service = new ConversationService({
    config,
    dutyConfig: { operator_name: "甲", line: { team_members: ["甲", "乙"] }, sources: { mode: "online", online: { schedule: { file_url: "schedule" } } } },
    runner: { run: async ({ prompt }) => {
      calls.model += 1;
      assert.match(prompt, /动力值班/);
      return { ok: true, text: JSON.stringify({
        fillCard: { location: "测试机房", source: "事务工单", transactionNo: "SJSW20261101000001", roomTicketNo: "JF20261101000001", workContent: "故障维修", specificWork: "更换部件", expectedEnterAt: "2026-11-02 19:00" },
        weeklyRows: [["模型不应生成的周报"]], handoverRows: [["模型不应生成的交接"]],
      }) };
    } },
    docsClient,
    draftRepository: { update: async () => { calls.drafts += 1; throw new Error("动力任务不应写草稿"); } },
    state, pendingTasks, access: { isAuthorized: () => true }, logger: { error() {}, info() {} },
    browserFiller: { enabled: true, fill: async (task) => {
      calls.fill.push(task);
      return { configured: true, ok: submitted, submitted, taskNumber: "WD20261101001", verification: { ok: submitted } };
    } },
  });
  const responder = { replyText: async (s) => replies.push(s), replyProgress: async (_id, s) => replies.push(s) };
  const msg = { chatId: "test-chat", userId: "test-user", platform: "wecom", text: "工单", images: [], receivedAt: "2026-11-01T10:00:00+08:00" };
  const handle = async (text = "工单") => {
    await service.handle({ ...msg, text }, responder);
    const end = Date.now() + 1000;
    while (service.queue.running || service.queue.size) {
      if (Date.now() > end) throw new Error("queue timeout");
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  return { handle, calls, replies, pendingTasks, setOperator: (name) => { onDuty = name; } };
}

test("动力收单跳过周报交接读取和生成，即便direct-draft配置或模型返回了草稿", async () => {
  const f = setup();
  await f.handle();
  assert.deepEqual(f.calls.tables, ["schedule"]);
  assert.equal(f.calls.fill.length, 1);
  assert.equal(f.calls.fill[0].workflowMode, "power-duty");
  assert.deepEqual(f.calls.fill[0].draftSpec, { weeklyRows: [], handoverRows: [] });
  assert.equal(f.calls.fill[0].powerDuty.date, "20261101");
  assert.equal(f.pendingTasks.find("1", "test-chat").status, "completed");
  await f.handle("/done 1");
  await f.handle("/fill 1");
  assert.equal(f.calls.drafts, 0);
  assert.equal(f.calls.fill.length, 1);
  assert.ok(f.replies.some((s) => s.includes("无需 /done")));
  assert.ok(f.replies.every((s) => !s.includes("腾讯草稿请发送")));
});

test("未提交的动力工单仍禁止/done写草稿；重试前核对调班", async () => {
  const f = setup({ submitted: false });
  await f.handle();
  await f.handle("/done 1");
  assert.equal(f.calls.drafts, 0);
  f.setOperator("乙");
  await f.handle("/fill 1");
  assert.equal(f.calls.fill.length, 1);
  assert.ok(f.replies.some((s) => s.includes("在线排班已变更")));
});

test("排班读取失败时不调用模型和浏览器，不误走普通写草稿流程", async () => {
  const f = setup({ readFails: true });
  await f.handle();
  assert.equal(f.calls.model, 0);
  assert.equal(f.calls.fill.length, 0);
  assert.equal(f.calls.drafts, 0);
  assert.ok(f.replies.some((s) => s.includes("排班离线")));
});
