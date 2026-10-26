const fs = require("fs");
const path = require("path");

const PRICING = Object.freeze({
  peak: Object.freeze({ hit: 0.04, miss: 2.0, out: 8.0 }),
  off: Object.freeze({ hit: 0.02, miss: 1.0, out: 4.0 }),
});

function shanghaiNow() {
  try {
    return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Shanghai" }));
  } catch {
    return new Date();
  }
}

function dayKey(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isPeakTime(date) {
  const day = date.getDay();
  const minutes = date.getHours() * 60 + date.getMinutes();
  const weekday = day >= 1 && day <= 5;
  return weekday && (
    (minutes >= 9 * 60 && minutes < 12 * 60)
    || (minutes >= 14 * 60 && minutes < 18 * 60)
  );
}

function createUsageTracker({
  dataRoot,
  nowProvider = shanghaiNow,
} = {}) {
  if (!dataRoot) throw new Error("usage tracker 缺少 dataRoot");
  const usageDir = path.join(dataRoot, "cache", "token-usage");
  const usageFile = path.join(usageDir, "daily.json");
  fs.mkdirSync(usageDir, { recursive: true });

  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(usageFile, "utf8"));
  } catch {
    data = {};
  }

  function save() {
    try {
      fs.writeFileSync(usageFile, JSON.stringify(data, null, 2), "utf8");
    } catch {}
  }

  function record(usage) {
    if (!usage) return;
    const now = nowProvider();
    const key = dayKey(now);
    const entry = data[key] || {
      calls: 0,
      input: 0,
      cached: 0,
      output: 0,
      cost: 0,
    };
    const input = Number(usage.input_tokens || 0);
    const hit = Math.min(Number(usage.cached_input_tokens || 0), input);
    const miss = Math.max(0, input - hit);
    const output = Number(usage.output_tokens || 0);
    const rate = isPeakTime(now) ? PRICING.peak : PRICING.off;
    entry.calls += 1;
    entry.input += miss;
    entry.cached += hit;
    entry.output += output;
    entry.cost += (hit / 1e6) * rate.hit
      + (miss / 1e6) * rate.miss
      + (output / 1e6) * rate.out;
    data[key] = entry;
    save();
  }

  function format(key) {
    const entry = data[key];
    if (!entry || !entry.calls) {
      return `今日（${key}）没有模型调用，未产生 token 消耗。`;
    }
    const number = (value) => Number(value || 0).toLocaleString("en-US");
    return [
      `Codex 用量（${key}）`,
      `模型调用：${entry.calls} 次`,
      `输入：${number(entry.input)}（缓存未命中）+ ${number(entry.cached)}（缓存命中）`,
      `输出：${number(entry.output)}`,
      `预估费用：¥${Number(entry.cost).toFixed(4)}`,
      "计价：DeepSeek Flash，高峰/空闲已分别计算",
    ].join("\n");
  }

  function get(key) {
    return data[key];
  }

  function markSent(key) {
    data.lastSent = key;
    save();
  }

  return {
    dayKey,
    format,
    get,
    markSent,
    now: nowProvider,
    record,
  };
}

module.exports = {
  PRICING,
  createUsageTracker,
  dayKey,
  isPeakTime,
  shanghaiNow,
};
