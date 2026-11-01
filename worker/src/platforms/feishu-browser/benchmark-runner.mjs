import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { summarizeBenchmark } from "./e2e-benchmark.mjs";

export function validateBenchmarkOptions({ runs, minSuccessRate, maxP95Ms }) {
  if (!Number.isSafeInteger(runs) || runs < 1) throw new Error("runs 必须为正整数");
  if (!Number.isFinite(minSuccessRate) || minSuccessRate <= 0 || minSuccessRate > 1) {
    throw new Error("min-success-rate 必须大于 0 且不超过 1");
  }
  if (!Number.isFinite(maxP95Ms) || maxP95Ms <= 0) throw new Error("max-p95-ms 必须为正数");
}

async function save(target, report) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  await fs.rename(temporary, target);
}

export async function runPersistentBenchmark({
  runs, minSuccessRate, maxP95Ms, targetFingerprint, recordPath, resume = false,
  buildTask, fill, onProgress = () => {},
}) {
  validateBenchmarkOptions({ runs, minSuccessRate, maxP95Ms });
  if (!recordPath) throw new Error("执行必须提供 --record，保证中断进度可恢复");
  const target = path.resolve(recordPath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  let lock;
  try {
    lock = await fs.open(`${target}.lock`, "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error("该报告存在运行锁；先确认旧进程已退出，再清理锁文件，禁止并发执行同一批次");
  }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    let previous;
    try { previous = JSON.parse(await fs.readFile(target, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (previous && !resume) throw new Error("报告已存在，请使用 --resume 或选择新的 --record 路径");
    if (!previous && resume) throw new Error("找不到续跑报告，请先开始新批次");
    const report = previous || {
      version: 1, generatedAt: new Date().toISOString(), targetFingerprint,
      runs, minSuccessRate, maxP95Ms, batchSeed: Date.now(), results: [], inFlight: null,
    };
    if (report.version !== 1 || report.targetFingerprint !== targetFingerprint
      || report.runs !== runs || report.minSuccessRate !== minSuccessRate || report.maxP95Ms !== maxP95Ms
      || !Number.isSafeInteger(report.batchSeed) || !Array.isArray(report.results)
      || report.results.length > runs || report.results.some((item, index) => item.index !== index + 1
        || typeof item.ok !== "boolean" || !Number.isFinite(item.elapsedMs) || item.elapsedMs < 0)) {
      throw new Error("续跑报告损坏或目标表、次数、验收门槛与原批次不一致，停止执行");
    }
    if (report.inFlight) {
      throw new Error(`第 ${report.inFlight.index} 次建单结果未知，禁止自动重试。请先在测试表核对单号 ${report.inFlight.transactionNo} 并保留报告`);
    }
    async function checkpoint(status) {
      report.status = status;
      report.updatedAt = new Date().toISOString();
      report.summary = summarizeBenchmark(report.results);
      report.passed = report.results.length === runs
        && report.summary.successRate >= minSuccessRate && report.summary.p95Ms <= maxP95Ms;
      await save(target, report);
    }
    await checkpoint("running");
    for (let index = report.results.length; index < runs; index += 1) {
      const task = buildTask({ index, batchSeed: report.batchSeed });
      report.inFlight = { index: index + 1, transactionNo: task.fillCard.transactionNo };
      await checkpoint("running");
      const startedAt = performance.now();
      let result;
      try { result = await fill(task); }
      catch (error) {
        await checkpoint("interrupted");
        throw new Error(`第 ${index + 1} 次中断，已完成 ${report.results.length}/${runs} 次；本次结果未知，需核对测试表后再处理`, { cause: error });
      }
      report.results.push({
        index: index + 1, ok: Boolean(result.submitted && result.verification?.ok),
        elapsedMs: Math.round(performance.now() - startedAt), submitted: Boolean(result.submitted),
        code: result.diagnostics?.code || "", stage: result.diagnostics?.stage || "",
        message: result.message || result.diagnostics?.errorMessage || "", failedFields: result.failed || [],
      });
      report.inFlight = null;
      await checkpoint(index + 1 === runs ? "complete" : "running");
      await onProgress(report);
    }
    await checkpoint("complete");
    return report;
  } finally {
    await lock.close();
    await fs.unlink(`${target}.lock`);
  }
}
