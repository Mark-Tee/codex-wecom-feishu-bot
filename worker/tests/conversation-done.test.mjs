import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { ConversationService } from "../src/runtime/conversation-service.mjs";
import { PendingTaskStore } from "../src/runtime/pending-task-store.mjs";

class MemoryState {
  constructor() {
    this.data = {};
  }

  get(key, fallback) {
    return structuredClone(this.data[key] ?? fallback);
  }

  set(key, value) {
    this.data[key] = structuredClone(value);
  }
}

function validSpec() {
  return {
    weeklyRows: [[
      1, "南区机房", "其他临时工作", "更换光模块", "否", "10.26",
      "1h", "网络一线", "网络一线", "测试甲", "否", "否", "09:00", "10:00",
      "已完成", "无", "1时00分",
    ]],
    handoverRows: [[
      "20261026", "网络", "白班", "测试甲",
      "1、日常机房巡检", "无", "测试乙", "", "",
    ]],
  };
}

function responseCollector() {
  const replies = [];
  return {
    replies,
    responder: {
      replyText: async (text) => replies.push({ kind: "text", text }),
      replyProgress: async (_id, text) => replies.push({ kind: "progress", text }),
    },
  };
}

function createService({
  update,
  state = new MemoryState(),
  runner = { run: async () => ({ ok: true, text: "" }), stop() {} },
  docsClient = {},
  browserFiller,
  specRoot = path.join(process.env.TEMP || ".", "idc-duty-test-drafts"),
  dutyConfig = {
    operator_name: "测试甲",
    line: { team_members: ["测试甲", "测试乙"] },
  },
} = {}) {
  const pendingTasks = new PendingTaskStore(state, {
    now: () => Date.parse("2026-10-26T10:00:00+08:00"),
  });
  const config = {
    duty: {
      enabled: true,
      workflowMode: "manual-feishu",
      defaultOperator: "测试甲",
    },
    runtime: {
      specRoot,
    },
    feishuBrowser: {
      autoFill: true,
    },
  };
  const service = new ConversationService({
    config,
    dutyConfig,
    runner,
    docsClient,
    draftRepository: { update },
    state,
    access: { isAuthorized: () => true },
    logger: { info() {}, warn() {}, error() {} },
    pendingTasks,
    browserFiller,
  });
  return { service, state, pendingTasks };
}

function message(text, chatId = "chat-a") {
  return {
    id: `m-${text}`,
    chatId,
    chatType: "group",
    userId: "u1",
    platform: "wecom",
    text,
    images: [],
    receivedAt: "2026-10-26T10:00:00+08:00",
  };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

function waitForReply(replies, phrase, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const found = replies.find((reply) => reply.text.includes(phrase));
      if (found) {
        clearInterval(timer);
        resolve(found);
      } else if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`等待回复超时：${phrase}\n已收到：${JSON.stringify(replies)}`));
      }
    }, 5);
  });
}

test("/done 使用持久化草稿并防止重复写入", async () => {
  const calls = [];
  const { service, pendingTasks } = createService({
    update: async (spec) => {
      calls.push(spec);
      return {
        fileUrl: "https://docs.example/draft",
        weeklyRows: 2,
        handoverRows: 1,
        keptDates: ["20261026"],
      };
    },
  });
  pendingTasks.create({
    chatId: "chat-a",
    operator: "测试甲",
    fillCard: {
      transactionNo: "SJSW20261026000001",
      roomTicketNo: "JF20261026000001",
    },
    draftSpec: validSpec(),
    currentDate: "20261026",
    previousDate: "",
  });
  const first = responseCollector();
  await service.handle(message("/done 1"), first.responder);
  await settle();
  assert.equal(calls.length, 1);
  assert.match(first.replies.at(-1).text, /腾讯文档草稿已更新/);

  const second = responseCollector();
  await service.handle(message("/done 1"), second.responder);
  await settle();
  assert.equal(calls.length, 1);
  assert.match(second.replies.at(-1).text, /不会重复写入/);
});

test("跨会话短号和 /help 都有明确结果", async () => {
  const { service, pendingTasks } = createService({
    update: async () => {
      throw new Error("不应写入");
    },
  });
  pendingTasks.create({
    chatId: "chat-a",
    operator: "测试甲",
    draftSpec: validSpec(),
    currentDate: "20261026",
  });
  const otherChat = responseCollector();
  await service.handle(message("/done 1", "chat-b"), otherChat.responder);
  await settle();
  assert.match(otherChat.replies.at(-1).text, /没有找到工单短号/);

  const help = responseCollector();
  await service.handle(message("/help"), help.responder);
  assert.match(help.replies.at(-1).text, /\/done <短号>/);
  assert.match(help.replies.at(-1).text, /\/fill <短号>/);
  assert.match(help.replies.at(-1).text, /飞书中创建、核对和提交任务/);
});

test("/fill 重新填写已保存的本地工单", async () => {
  let filledTask = null;
  const browserFiller = {
    enabled: true,
    async fill(task) {
      filledTask = task;
      return {
        ok: true,
        configured: true,
        filled: ["任务地点", "事务单号"],
        skipped: [],
        submitted: true,
        pageUrl: "https://example.feishu.cn/base/form",
      };
    },
  };
  const { service, pendingTasks } = createService({
    update: async () => {
      throw new Error("不应写入");
    },
    browserFiller,
  });
  pendingTasks.create({
    chatId: "chat-a",
    operator: "测试甲",
    fillCard: {
      location: "测试机房",
      transactionNo: "SJSW20261026000001",
      roomTicketNo: "JF20261026000001",
    },
  });
  const collector = responseCollector();
  await service.handle(message("/fill 1"), collector.responder);
  await settle();
  assert.equal(filledTask.id, "1");
  assert.match(collector.replies.at(-1).text, /飞书已自动核对并提交/);
  assert.equal(pendingTasks.find("1", "chat-a").browserFill.ok, true);
  assert.equal(pendingTasks.find("1", "chat-a").browserFill.submitted, true);
});

test("浏览器自动提交后只回复结果，不再发送完整填报卡", async (t) => {
  const tempRoot = process.env.TEMP || ".";
  await fs.mkdir(tempRoot, { recursive: true });
  const specRoot = await fs.mkdtemp(path.join(tempRoot, "idc-duty-test-"));
  t.after(() => fs.rm(specRoot, { recursive: true, force: true }));

  let updateCalls = 0;
  const dutyConfig = {
    operator_name: "测试甲",
    sources: {
      mode: "online",
      online: {
        schedule: { file_url: "schedule" },
        weekly: { file_url: "weekly" },
        handover: { file_url: "handover" },
      },
    },
    schedule: {
      sheet_format: "YYYYMM",
      primary_white_value: "白班",
      primary_night_value: "夜班",
      primary_white_fill: "FFFF00",
      primary_night_fill: "B4C6E7",
    },
    weekly: { sheet_format: "M月" },
    handover: {
      sheet_format: "M月",
      inspection_text: "日常机房巡检",
    },
    line: {
      name: "网络",
      team_members: ["测试甲", "测试乙"],
      aux_column_header: "网络辅值",
    },
    defaults: {
      work_location: "南区机房",
      requester: "动力值班",
      publisher: "动力值班",
    },
  };
  const csv = {
    schedule: [
      ["日期", "测试甲", "测试乙", "网络辅值"],
      ["20261026", "白班", "夜班", ""],
    ],
    weekly: [
      Array.from({ length: 17 }, (_, index) => `周报列${index + 1}`),
    ],
    handover: [
      Array.from({ length: 9 }, (_, index) => `交接列${index + 1}`),
    ],
  };
  const toCsv = (rows) => rows.map((row) => row.map((value) => `"${value}"`).join(",")).join("\n");
  const docsClient = {
    async getSheetInfo(file) {
      const key = file.file_url;
      return {
        sheets: [{
          sheet_name: key === "schedule" ? "202610" : "10月",
          sheet_id: key,
          row_count: csv[key].length,
          col_count: csv[key][0].length,
        }],
      };
    },
    async getCsv(file) {
      return { csv_data: toCsv(csv[file.file_url]) };
    },
    async getStyles() {
      return {
        cells: [
          { row: 2, col: 0, background_color: "FFFFFFFF" },
          { row: 2, col: 1, background_color: "FFFF00" },
          { row: 2, col: 2, background_color: "B4C6E7" },
        ],
      };
    },
  };
  const spec = validSpec();
  const runner = {
    async run() {
      return {
        ok: true,
        seconds: 1,
        text: JSON.stringify({
          fillCard: {
            location: "南区机房",
            source: "事务工单",
            transactionNo: "SJSW20261026000001",
            roomTicketNo: "JF20261026000001",
            workContent: "故障维修",
            specificWork: "更换光模块",
            expectedEnterAt: "2026-10-26 09:00",
          },
          ...spec,
        }),
      };
    },
    stop() {},
  };
  const { service, pendingTasks } = createService({
    update: async () => {
      updateCalls += 1;
    },
    runner,
    docsClient,
    specRoot,
    dutyConfig,
    browserFiller: {
      enabled: true,
      async fill() {
        return {
          ok: true,
          configured: true,
          filled: ["任务地点", "事务单号"],
          skipped: [],
          failed: [],
          submitted: true,
          taskNumber: "WN20261026006",
        };
      },
    },
  });
  const collector = responseCollector();
  const imageMessage = {
    ...message(""),
    text: "预计进入时间：09:00",
    images: [{ path: "sample.jpg", text: "预计进入时间：09:00" }],
    ocrText: "预计进入时间：09:00",
  };
  await service.handle(imageMessage, collector.responder);
  const reply = await waitForReply(collector.replies, "飞书已自动核对并提交");
  assert.doesNotMatch(reply.text, /飞书填报卡/);
  assert.match(reply.text, /本地短号：6/);
  assert.match(reply.text, /\/done 6/);
  assert.equal(updateCalls, 0);
  assert.equal(pendingTasks.activeCount("chat-a"), 1);
  assert.equal(pendingTasks.find("6", "chat-a").browserFill.taskNumber, "WN20261026006");
  assert.equal(pendingTasks.find("1", "chat-a"), null);
});
