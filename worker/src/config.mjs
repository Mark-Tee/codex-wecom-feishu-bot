import fs from "node:fs";
import path from "node:path";

function required(value, label) {
  if (!value) throw new Error(`配置缺少必填项：${label}`);
}

export function loadConfig(configPath = path.resolve("config.json")) {
  const absolutePath = path.resolve(configPath);
  const configRoot = path.dirname(absolutePath);
  const config = JSON.parse(fs.readFileSync(absolutePath, "utf8").replace(/^\uFEFF/, ""));

  required(config.platform?.type, "platform.type");
  required(config.runtime?.workdir, "runtime.workdir");
  required(config.duty?.configPath, "duty.configPath");
  required(config.duty?.defaultOperator, "duty.defaultOperator");

  config.dataDir = path.resolve(configRoot, config.dataDir || "data");
  config.runtime.maxSeconds = Number(config.runtime.maxSeconds || 300);
  config.runtime.specRoot = path.resolve(
    config.runtime.specRoot || path.join(config.dataDir, "drafts"),
  );
  config.runtime.workdir = path.resolve(configRoot, config.runtime.workdir || ".");
  config.duty.configPath = path.resolve(configRoot, config.duty.configPath);
  config.runtime.allowUsers = Array.isArray(config.runtime.allowUsers)
    ? config.runtime.allowUsers
    : [];
  config.duty.reasoningEffort = config.duty.reasoningEffort || "low";
  config.duty.workflowMode = ["manual-feishu", "direct-draft"].includes(config.duty.workflowMode)
    ? config.duty.workflowMode
    : "manual-feishu";
  const browser = config.feishuBrowser || {};
  config.feishuBrowser = {
    enabled: Boolean(browser.enabled),
    autoFill: browser.autoFill !== false,
    autoSubmit: Boolean(browser.autoSubmit),
    entryMode: browser.entryMode === "form" ? "form" : "record",
    edgeExecutable: browser.edgeExecutable
      || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    profileDir: path.resolve(configRoot, browser.profileDir || path.join(config.dataDir, "feishu-browser-profile")),
    formUrl: String(browser.formUrl || "").trim(),
    taskListViewId: String(browser.taskListViewId || "").trim(),
    taskListPageSize: Number(browser.taskListPageSize || 3000),
    debugPort: Number(browser.debugPort || 9223),
    launchTimeoutMs: Number(browser.launchTimeoutMs || 20_000),
    formTimeoutMs: Number(browser.formTimeoutMs || 20_000),
    fieldIds: browser.fieldIds || {},
    options: {
      source: Array.isArray(browser.options?.source) ? browser.options.source : [],
      location: Array.isArray(browser.options?.location) ? browser.options.location : [],
      workContent: Array.isArray(browser.options?.workContent) ? browser.options.workContent : [],
    },
    defaults: browser.defaults || {},
  };
  if (config.feishuBrowser.enabled) {
    if (!config.feishuBrowser.formUrl) {
      throw new Error("feishuBrowser.enabled 为 true 时必须配置 formUrl");
    }
    for (const key of [
      "source",
      "location",
      "transactionNo",
      "roomTicketNo",
      "workContent",
      "expectedEnterAt",
      "assignees",
      "companions",
      "taskList",
    ]) {
      required(config.feishuBrowser.fieldIds[key], `feishuBrowser.fieldIds.${key}`);
    }
    if (config.feishuBrowser.entryMode === "record") {
      required(config.feishuBrowser.taskListViewId, "feishuBrowser.taskListViewId");
    }
  }
  config.notifications = config.notifications || {};
  config.notifications.port = Number(config.notifications?.port || 8799);

  return {
    ...config,
    configPath: absolutePath,
    rootDir: path.dirname(absolutePath),
  };
}

export function loadDutyConfig(config) {
  const duty = JSON.parse(fs.readFileSync(config.duty.configPath, "utf8"));
  if (config.duty.pinyinHints) {
    duty.line = {
      ...duty.line,
      pinyin_hints: config.duty.pinyinHints,
    };
  }
  if (config.duty.holidayNotification) {
    duty.handover = {
      ...duty.handover,
      holiday_notification: config.duty.holidayNotification,
    };
  }
  return duty;
}
