import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runPersistentBenchmark, validateBenchmarkOptions } from "../src/platforms/feishu-browser/benchmark-runner.mjs";

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "benchmark-checkpoint-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const recordPath = path.join(dir, "report.json");
  return {
    recordPath, runs: 3, minSuccessRate: 0.9, maxP95Ms: 60000,
    targetFingerprint: "test-table", buildTask: ({ index }) => ({ fillCard: { transactionNo: `test-${index}` } }),
    fill: async () => ({ submitted: true, verification: { ok: true } }),
  };
}

test("基准拒绝非有限次数和无效验收门槛", () => {
  const valid = { runs: 10, minSuccessRate: 0.9, maxP95Ms: 60000 };
  for (const runs of [NaN, Infinity, 0, -1, 1.5]) {
    assert.throws(() => validateBenchmarkOptions({ ...valid, runs }), /runs/);
  }
  for (const minSuccessRate of [NaN, 0, 1.1]) {
    assert.throws(() => validateBenchmarkOptions({ ...valid, minSuccessRate }), /min-success-rate/);
  }
  assert.throws(() => validateBenchmarkOptions({ ...valid, maxP95Ms: NaN }), /max-p95-ms/);
});

test("每轮调用前持久化未知状态，完成后持久化结果", async (t) => {
  const opts = await fixture(t);
  let calls = 0;
  opts.fill = async () => {
    const state = JSON.parse(await fs.readFile(opts.recordPath, "utf8"));
    calls += 1;
    assert.equal(state.inFlight.index, calls);
    assert.equal(state.results.length, calls - 1);
    assert.equal(state.passed, false);
    return { submitted: true, verification: { ok: true } };
  };
  const report = await runPersistentBenchmark(opts);
  assert.equal(report.status, "complete");
  assert.equal(report.results.length, 3);
  assert.equal(report.passed, true);
  assert.equal(report.inFlight, null);
});

test("已确认完成的轮次在续跑时不重复建单", async (t) => {
  const opts = await fixture(t);
  await assert.rejects(runPersistentBenchmark({ ...opts, onProgress: () => { throw new Error("stopped between runs"); } }), /stopped between runs/);
  const executed = [];
  const report = await runPersistentBenchmark({ ...opts, resume: true, fill: async (task) => {
    executed.push(task.fillCard.transactionNo);
    return { submitted: true, verification: { ok: true } };
  } });
  assert.deepEqual(executed, ["test-1", "test-2"]);
  assert.equal(report.summary.runs, 3);
});

test("建单时异常保留未知单号，续跑拒绝重复提交", async (t) => {
  const opts = await fixture(t);
  await assert.rejects(runPersistentBenchmark({ ...opts, fill: async () => { throw new Error("connection lost after submit"); } }), /结果未知/);
  const report = JSON.parse(await fs.readFile(opts.recordPath, "utf8"));
  assert.equal(report.status, "interrupted");
  assert.equal(report.inFlight.transactionNo, "test-0");
  let calls = 0;
  await assert.rejects(runPersistentBenchmark({ ...opts, resume: true, fill: async () => { calls += 1; } }), /禁止自动重试/);
  assert.equal(calls, 0);
});

test("已有报告不能覆盖，续跑不能换表或验收门槛", async (t) => {
  const opts = await fixture(t);
  await runPersistentBenchmark(opts);
  const saved = await fs.readFile(opts.recordPath, "utf8");
  await assert.rejects(runPersistentBenchmark(opts), /报告已存在/);
  await assert.rejects(runPersistentBenchmark({ ...opts, resume: true, targetFingerprint: "other-table" }), /不一致/);
  await assert.rejects(runPersistentBenchmark({ ...opts, resume: true, runs: 4 }), /不一致/);
  assert.equal(await fs.readFile(opts.recordPath, "utf8"), saved);
});

test("同一报告运行锁阻止并发创建记录", async (t) => {
  const opts = await fixture(t);
  let started;
  const entered = new Promise((resolve) => { started = resolve; });
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const running = runPersistentBenchmark({ ...opts, runs: 1, fill: async () => { started(); return pending; } });
  await entered;
  try {
    await assert.rejects(runPersistentBenchmark(opts), /运行锁/);
  } finally {
    release({ submitted: true, verification: { ok: true } });
    await running;
  }
});

test("无报告的续跑和损坏的报告均不创建记录", async (t) => {
  const opts = await fixture(t);
  await assert.rejects(runPersistentBenchmark({ ...opts, resume: true }), /找不到/);
  await fs.writeFile(opts.recordPath, "broken JSON");
  await assert.rejects(runPersistentBenchmark({ ...opts, resume: true }), SyntaxError);
  assert.equal(await fs.readFile(opts.recordPath, "utf8"), "broken JSON");
});
