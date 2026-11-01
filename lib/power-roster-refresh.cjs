const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function shanghaiClock(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const value = (key) => parts.find((part) => part.type === key).value;
  return { day: `${value("year")}-${value("month")}-${value("day")}`, minutes: Number(value("hour")) * 60 + Number(value("minute")) };
}

function createDailyRosterRefresh({ refresh, stampPath, now = () => new Date(), onError = () => {} }) {
  let busy = false;
  let retryAfter = 0;
  return async function tick() {
    const at = now();
    const clock = shanghaiClock(at);
    if (busy || at.getTime() < retryAfter || clock.minutes < 8 * 60 + 20) return;
    busy = true;
    try {
      let previous = {};
      try { previous = JSON.parse(await fs.readFile(stampPath, "utf8")); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      if (previous.day === clock.day) return;
      await refresh(at);
      await fs.mkdir(path.dirname(stampPath), { recursive: true });
      const tmp = `${stampPath}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify({ day: clock.day, refreshedAt: at.toISOString() }), { mode: 0o600 });
      await fs.rename(tmp, stampPath);
    } catch (error) {
      retryAfter = at.getTime() + 5 * 60 * 1000;
      onError(error);
    } finally { busy = false; }
  };
}

async function startPowerRosterRefresh({ workerRoot, configPath, log = () => {} }) {
  const fromWorker = (file) => import(pathToFileURL(path.join(workerRoot, file)).href);
  const { loadConfig, loadDutyConfig } = await fromWorker("src/config.mjs");
  const config = loadConfig(configPath);
  if (!config.duty.powerDuty?.enabled) return () => {};
  const { TencentDocsClient } = await fromWorker("src/providers/tencent-docs/client.mjs");
  const { readPowerRoster } = await fromWorker("src/providers/tencent-docs/power-roster.mjs");
  const tick = createDailyRosterRefresh({
    stampPath: path.join(config.dataDir, "cache", "power-roster-refresh.json"),
    refresh: async (at) => {
      const current = loadConfig(configPath);
      if (!current.duty.powerDuty?.enabled) return;
      await readPowerRoster({
        client: new TencentDocsClient(), config: loadDutyConfig(current),
        receivedAt: at.toISOString(), operator: current.duty.defaultOperator,
        cachePath: current.duty.powerDuty.cachePath,
      });
      log("动力值班排班已刷新（每日08:20，错过时启动补查）");
    },
    onError: () => log("动力值班排班刷新失败，5分钟后重试；处理工单时仍须重新读表"),
  });
  await tick();
  const timer = setInterval(() => tick().catch(() => {}), 30_000);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { createDailyRosterRefresh, startPowerRosterRefresh };
