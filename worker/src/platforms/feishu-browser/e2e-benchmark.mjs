import crypto from "node:crypto";

export function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  );
  return sorted[index];
}

export function tableFingerprint(formUrl) {
  return crypto.createHash("sha256")
    .update(String(formUrl || "").trim())
    .digest("hex")
    .slice(0, 12);
}

function shanghaiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
  };
}

export function buildTestTask({
  index = 0,
  operator,
  location,
  source = "事务工单",
  workContent = "故障维修、隐患整改",
  now = new Date(),
  batchSeed = Date.now(),
} = {}) {
  const parts = shanghaiParts(now);
  const date = [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("");
  const sequence = String((Number(batchSeed) + index) % 1_000_000).padStart(6, "0");
  const runMarker = `E2E-${date}-${sequence}`;
  return {
    receivedAt: now.toISOString(),
    operator,
    fillCard: {
      location,
      source,
      transactionNo: `SJSW${date}${sequence}`,
      roomTicketNo: `JF${date}${sequence}`,
      workContent,
      specificWork: `Codex 浏览器建单基准 ${runMarker}`,
      expectedEnterAt: `${parts.year}/${String(parts.month).padStart(2, "0")}/${String(parts.day).padStart(2, "0")} ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`,
    },
  };
}

export function summarizeBenchmark(results) {
  const successCount = results.filter((result) => result.ok).length;
  const latencies = results.map((result) => Number(result.elapsedMs || 0));
  const failureCounts = new Map();
  for (const result of results.filter((item) => !item.ok)) {
    const key = result.code || "unknown";
    failureCounts.set(key, (failureCounts.get(key) || 0) + 1);
  }
  return {
    runs: results.length,
    successes: successCount,
    failures: results.length - successCount,
    successRate: results.length ? successCount / results.length : 0,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    maxMs: latencies.length ? Math.max(...latencies) : 0,
    failureCounts: Object.fromEntries(failureCounts),
  };
}
