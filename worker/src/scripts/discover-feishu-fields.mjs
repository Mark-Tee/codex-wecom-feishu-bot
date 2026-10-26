import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.mjs";
import { EdgeFormSession } from "../platforms/feishu-browser/edge-session.mjs";
import {
  BROWSER_FIELD_LABELS,
  discoverFieldIds,
  discoverTaskListViewId,
  hasOpenRecordForm,
  openRecordFormForDiscovery,
} from "../platforms/feishu-browser/field-discovery.mjs";

function configPathFromArgs() {
  const index = process.argv.indexOf("--config");
  return path.resolve(index >= 0 ? process.argv[index + 1] : "config.json");
}

const configPath = configPathFromArgs();
const config = loadConfig(configPath);
const writeConfig = process.argv.includes("--write");
const checkOnly = process.argv.includes("--check");
const allowOpen = !process.argv.includes("--no-open");
const timeoutMs = Number(
  process.env.FEISHU_DISCOVERY_TIMEOUT_MS || config.feishuBrowser.formTimeoutMs,
);

if (!config.feishuBrowser.formUrl) {
  throw new Error("feishuBrowser.formUrl 为空");
}

const session = await EdgeFormSession.open(config.feishuBrowser);
try {
  let discovery = await discoverFieldIds(session, {
    fieldIds: config.feishuBrowser.fieldIds,
    mode: config.feishuBrowser.entryMode,
  });
  if (discovery.missingActual.length) {
    if (!allowOpen) {
      throw new Error("没有发现完整记录卡字段。请先打开任意记录，或去掉 --no-open 后重试。");
    }
    discovery = await openRecordFormForDiscovery(session, {
      timeoutMs,
      existingFieldIds: discovery.fieldIds,
    });
  }
  if (discovery.missingActual.length) {
    const labels = discovery.missing.map((key) => BROWSER_FIELD_LABELS[key] || key);
    throw new Error(`记录卡缺少字段：${labels.join("、")}`);
  }

  let taskListViewId = config.feishuBrowser.taskListViewId;
  if (!taskListViewId && config.feishuBrowser.entryMode === "record") {
    if (!(await hasOpenRecordForm(session))) {
      throw new Error("无法在发现字段后读取任务列表视图");
    }
    taskListViewId = await discoverTaskListViewId(session);
  }
  if (config.feishuBrowser.entryMode === "record" && !taskListViewId) {
    throw new Error("没有发现“全部任务列表”视图 ID");
  }

  if (writeConfig) {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
    raw.feishuBrowser = raw.feishuBrowser || {};
    raw.feishuBrowser.enabled = true;
    raw.feishuBrowser.autoDiscoverFields = true;
    raw.feishuBrowser.fieldIds = discovery.fieldIds;
    if (taskListViewId) raw.feishuBrowser.taskListViewId = taskListViewId;
    fs.writeFileSync(configPath, JSON.stringify(raw, null, 2) + "\n", "utf8");
  }

  const output = checkOnly
    ? {
        ok: true,
        foundFields: discovery.foundCount,
        requiredFields: Object.keys(BROWSER_FIELD_LABELS).length,
        taskListViewFound: Boolean(taskListViewId),
        written: writeConfig,
      }
    : {
        ...discovery.fieldIds,
        taskListViewId,
      };
  process.stdout.write(JSON.stringify(output, null, 2));
} finally {
  session.close();
}
