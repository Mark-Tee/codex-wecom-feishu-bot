import { FeishuTaskCreationService } from "../providers/feishu-base/task-service.mjs";

const TOTAL = Number(process.argv.find((item) => item.startsWith("--total="))?.split("=")[1] || 100);
const CONCURRENCY = Number(process.argv.find((item) => item.startsWith("--concurrency="))?.split("=")[1] || 20);
const NETWORK_DELAY_MS = Number(process.argv.find((item) => item.startsWith("--delay="))?.split("=")[1] || 0);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] || 0;
}

function createMockClient() {
  const records = [];
  const calls = { tokens: 0, fields: 0, searches: 0, creates: 0 };
  const delay = () => NETWORK_DELAY_MS ? sleep(NETWORK_DELAY_MS) : Promise.resolve();
  return {
    calls,
    async warmToken() {
      calls.tokens += 1;
      await delay();
      return "token";
    },
    async listFields() {
      calls.fields += 1;
      await delay();
      return [
        { field_name: "任务列表", type: 1 },
        { field_name: "任务地点", type: 3 },
        { field_name: "任务来源", type: 3 },
        { field_name: "事务单号", type: 1 },
        { field_name: "机房单号", type: 1 },
        { field_name: "工作内容", type: 4 },
        { field_name: "具体工作事项", type: 1 },
        { field_name: "预计进入时间", type: 5 },
      ];
    },
    async listRecords({ filter }) {
      calls.searches += 1;
      await delay();
      const conditions = filter?.conditions || [];
      return records.filter((record) => conditions.some((condition) => {
        const value = record.fields[condition.field_name];
        if (condition.operator === "contains") {
          return String(value || "").includes(condition.value[0]);
        }
        return condition.value.includes(value);
      }));
    },
    async createRecord(_table, fields) {
      calls.creates += 1;
      await delay();
      const record = { record_id: `rec-${calls.creates}`, fields };
      records.push(record);
      return record;
    },
  };
}

const order = (index) => ({
  location: "测试机房",
  source: "事务工单",
  transactionNo: `SJSW20261026${String(index).padStart(7, "0")}`,
  roomTicketNo: `JF20261026${String(index).padStart(7, "0")}`,
  workContent: "故障维修、更换",
  specificWork: "光模块更换",
  expectedEnterAt: "2026-10-26T20:00:00+08:00",
});

const client = createMockClient();
const service = new FeishuTaskCreationService({
  client,
  appToken: "benchmark",
  taskTableId: "tasks",
});
const startedAt = performance.now();
await service.warm();
const latencies = [];
const taskNumbers = [];
for (let offset = 0; offset < TOTAL; offset += CONCURRENCY) {
  const batch = Array.from(
    { length: Math.min(CONCURRENCY, TOTAL - offset) },
    (_, index) => offset + index,
  );
  const results = await Promise.all(batch.map(async (index) => {
    const requestStartedAt = performance.now();
    const result = await service.createOrReuse(order(index), {
      receivedAt: "2026-10-26T20:00:00+08:00",
    });
    return { result, elapsedMs: performance.now() - requestStartedAt };
  }));
  latencies.push(...results.map((item) => item.elapsedMs));
  taskNumbers.push(...results.map((item) => item.result.taskNumber));
}
const totalMs = performance.now() - startedAt;
const uniqueNumbers = new Set(taskNumbers);
console.log(JSON.stringify({
  mode: NETWORK_DELAY_MS ? `simulated-${NETWORK_DELAY_MS}ms` : "code-only",
  total: TOTAL,
  concurrency: CONCURRENCY,
  totalMs: Math.round(totalMs),
  throughputPerSecond: Number((TOTAL / (totalMs / 1000)).toFixed(1)),
  p50Ms: Math.round(percentile(latencies, 0.5)),
  p95Ms: Math.round(percentile(latencies, 0.95)),
  maxMs: Math.round(Math.max(...latencies)),
  uniqueTaskNumbers: uniqueNumbers.size,
  duplicateTaskNumbers: TOTAL - uniqueNumbers.size,
  calls: client.calls,
}, null, 2));
