const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createDailyRosterRefresh } = require("../lib/power-roster-refresh.cjs");

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "power-roster-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, "stamp.json");
}

test("北京时间08:20刷新一次，重启不重复，次日恢复运行补查", async (t) => {
  const stampPath = await fixture(t);
  let at = new Date("2026-11-01T08:19:59+08:00");
  let calls = 0;
  const opts = { stampPath, now: () => at, refresh: async () => { calls += 1; } };
  const tick = createDailyRosterRefresh(opts);
  await tick(); assert.equal(calls, 0);
  at = new Date("2026-11-01T08:20:00+08:00");
  await tick(); await tick(); assert.equal(calls, 1);
  await createDailyRosterRefresh(opts)(); assert.equal(calls, 1);
  at = new Date("2026-11-02T09:00:00+08:00");
  await createDailyRosterRefresh(opts)(); assert.equal(calls, 2);
});

test("刷新失败不记为成功，5分钟后重试，不并发冲击在线表", async (t) => {
  const stampPath = await fixture(t);
  let at = new Date("2026-11-01T08:20:00+08:00");
  let calls = 0;
  let errors = 0;
  const tick = createDailyRosterRefresh({ stampPath, now: () => at, refresh: async () => { calls += 1; if (calls === 1) throw new Error("offline"); }, onError: () => { errors += 1; } });
  await Promise.all([tick(), tick()]);
  assert.equal(calls, 1); assert.equal(errors, 1);
  await assert.rejects(fs.readFile(stampPath), { code: "ENOENT" });
  at = new Date("2026-11-01T08:24:59+08:00"); await tick(); assert.equal(calls, 1);
  at = new Date("2026-11-01T08:25:00+08:00"); await tick(); assert.equal(calls, 2);
});
