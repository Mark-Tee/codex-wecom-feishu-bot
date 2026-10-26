import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.mjs";

function fixture({ autoDiscoverFields }) {
  const root = path.join(process.cwd(), "data");
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, "test-config-"));
  const configPath = path.join(dir, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({
    platform: { type: "wecom" },
    runtime: { workdir: "." },
    duty: {
      configPath: "duty.json",
      defaultOperator: "tester",
    },
    feishuBrowser: {
      enabled: true,
      autoDiscoverFields,
      formUrl: "https://example.feishu.cn/base/example?table=tblExample",
      taskListViewId: "YOUR_ALL_TASKS_VIEW_ID",
      fieldIds: {
        taskList: "fldTaskPlaceholder",
      },
    },
  }), "utf8");
  return {
    dir,
    configPath,
  };
}

test("首次配置允许字段自动发现并丢弃占位 ID", () => {
  const temp = fixture({ autoDiscoverFields: true });
  try {
    const config = loadConfig(temp.configPath);
    assert.equal(config.feishuBrowser.autoDiscoverFields, true);
    assert.deepEqual(config.feishuBrowser.fieldIds, {});
    assert.equal(config.feishuBrowser.taskListViewId, "");
    assert.equal(config.feishuBrowser.diagnostics.enabled, true);
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("关闭自动发现时仍要求完整字段映射", () => {
  const temp = fixture({ autoDiscoverFields: false });
  try {
    assert.throws(() => loadConfig(temp.configPath), /fieldIds\.source/);
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});
