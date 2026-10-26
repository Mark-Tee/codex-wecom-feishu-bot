import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config.mjs";
import { FeishuBrowserFormFiller } from "../platforms/feishu-browser/form-filler.mjs";
import {
  buildTestTask,
  summarizeBenchmark,
  tableFingerprint,
} from "../platforms/feishu-browser/e2e-benchmark.mjs";

function arg(name, fallback = "") {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")) {
    return process.argv[index + 1];
  }
  const prefix = `--${name}=`;
  const found = process.argv.find((item) => item.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const configPath = path.resolve(arg("config", "config.json"));
const runs = Math.max(1, Number(arg("runs", "10")));
const execute = process.argv.includes("--execute");
const confirmTable = arg("confirm-table");
const recordPath = arg("record");
const minSuccessRate = Number(arg("min-success-rate", "0.9"));
const maxP95Ms = Number(arg("max-p95-ms", "60000"));
const config = loadConfig(configPath);
const fingerprint = tableFingerprint(config.feishuBrowser.formUrl);

if (!config.feishuBrowser.enabled) {
  throw new Error("feishuBrowser.enabled 必须为 true");
}
if (!config.feishuBrowser.autoSubmit) {
  throw new Error("feishuBrowser.autoSubmit 必须为 true");
}
if (!config.feishuBrowser.options.location?.length) {
  throw new Error("feishuBrowser.options.location 为空");
}

if (!execute) {
  process.stdout.write(JSON.stringify({
    mode: "plan",
    runs,
    targetFingerprint: fingerprint,
    willCreateRecords: true,
    message: "确认是专用测试表后，使用 --execute --confirm-table=<targetFingerprint>。",
  }, null, 2));
  process.exit(0);
}
if (confirmTable !== fingerprint) {
  throw new Error(
    `测试表确认不一致。先运行不带 --execute 的计划模式，并核对 targetFingerprint=${fingerprint}`,
  );
}

const filler = new FeishuBrowserFormFiller({
  config: config.feishuBrowser,
  logger: {
    info: (...parts) => process.stderr.write(`[info] ${parts.join(" ")}\n`),
    warn: (...parts) => process.stderr.write(`[warn] ${parts.join(" ")}\n`),
    error: (...parts) => process.stderr.write(`[error] ${parts.join(" ")}\n`),
  },
});
const results = [];
const batchSeed = Number(String(Date.now()).slice(-6));
for (let index = 0; index < runs; index += 1) {
  const task = buildTestTask({
    index,
    operator: config.duty.defaultOperator,
    location: config.feishuBrowser.options.location[0],
    source: config.feishuBrowser.defaults?.source
      || config.feishuBrowser.options.source?.[0]
      || "事务工单",
    workContent: config.feishuBrowser.options.workContent?.[0],
    batchSeed,
  });
  const startedAt = performance.now();
  const result = await filler.fill(task);
  results.push({
    index: index + 1,
    ok: Boolean(result.submitted && result.verification?.ok),
    elapsedMs: Math.round(performance.now() - startedAt),
    submitted: Boolean(result.submitted),
    code: result.diagnostics?.code || "",
    stage: result.diagnostics?.stage || "",
    message: result.message || result.diagnostics?.errorMessage || "",
    failedFields: result.failed || [],
  });
}

const summary = summarizeBenchmark(results);
const passed = summary.successRate >= minSuccessRate && summary.p95Ms <= maxP95Ms;
const report = {
  generatedAt: new Date().toISOString(),
  targetFingerprint: fingerprint,
  minSuccessRate,
  maxP95Ms,
  passed,
  summary,
  results,
};
if (recordPath) {
  const target = path.resolve(recordPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(report, null, 2) + "\n", "utf8");
}
process.stdout.write(JSON.stringify(report, null, 2));
process.exitCode = passed ? 0 : 1;
