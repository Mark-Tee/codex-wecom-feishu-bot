import path from "node:path";
import { loadConfig } from "../config.mjs";
import { FeishuBrowserFormFiller } from "../platforms/feishu-browser/form-filler.mjs";
import {
  buildTestTask,
  tableFingerprint,
} from "../platforms/feishu-browser/e2e-benchmark.mjs";
import { runPersistentBenchmark, validateBenchmarkOptions } from "../platforms/feishu-browser/benchmark-runner.mjs";

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

if (process.argv.includes("--help")) {
  process.stdout.write(`飞书专用测试表建单验收（禁止指向生产表）
计划：node benchmark-feishu-e2e.mjs --config <测试配置> --runs 10
执行：加 --execute --confirm-table <计划指纹> --record <本地报告.json>
续跑：相同参数加 --resume；已完成轮次不会重跑，结果未知的轮次禁止自动重试。
参数：--min-success-rate 默认 0.9；--max-p95-ms 默认 60000；--runs 为正整数。
示例：--config worker/config.e2e.json --runs 10 --record ./data/records/e2e.json
限制：仅串行创建记录，不自动删除；报告每轮保存。进程异常退出后需确认旧进程已退出再清理同名 .lock 文件。
`);
  process.exit(0);
}

const configPath = path.resolve(arg("config", "config.json"));
const runs = Number(arg("runs", "10"));
const execute = process.argv.includes("--execute");
const confirmTable = arg("confirm-table");
const recordPath = arg("record");
const minSuccessRate = Number(arg("min-success-rate", "0.9"));
const maxP95Ms = Number(arg("max-p95-ms", "60000"));
validateBenchmarkOptions({ runs, minSuccessRate, maxP95Ms });
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
    requiresCheckpoint: true,
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
const report = await runPersistentBenchmark({
  runs, minSuccessRate, maxP95Ms, targetFingerprint: fingerprint, recordPath,
  resume: process.argv.includes("--resume"),
  buildTask: ({ index, batchSeed }) => buildTestTask({
    index,
    operator: config.duty.defaultOperator,
    location: config.feishuBrowser.options.location[0],
    source: config.feishuBrowser.defaults?.source
      || config.feishuBrowser.options.source?.[0]
      || "事务工单",
    workContent: config.feishuBrowser.options.workContent?.[0],
    batchSeed,
  }),
  fill: (task) => filler.fill(task),
  onProgress: (state) => process.stderr.write(
    `已完成 ${state.results.length}/${runs} 次，成功 ${state.summary.successes} 次；进度已保存。\n`,
  ),
});
process.stdout.write(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;
