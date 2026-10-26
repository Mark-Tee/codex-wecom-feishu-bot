import path from "node:path";
import { loadConfig, loadDutyConfig } from "../config.mjs";
import { TencentDocsClient } from "../providers/tencent-docs/client.mjs";
import { buildDutyContext } from "../providers/tencent-docs/duty-context.mjs";

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? fallback : process.argv[index + 1];
  return String(value ?? "").replace(/^["']|["']$/g, "");
}

const config = loadConfig(path.resolve(argument("--config", "config.json")));
const dutyConfig = loadDutyConfig(config);
const client = new TencentDocsClient();
const prompt = argument(
  "--prompt",
  "工单日期 2026-01-01 19:00 至 2026-01-02 01:00",
);
const receivedAt = argument("--received-at", new Date().toISOString());
const operator = argument("--operator", config.duty.defaultOperator);

const context = await buildDutyContext({
  client,
  config: dutyConfig,
  prompt,
  receivedAt,
  operator,
});

console.log(JSON.stringify({
  ok: true,
  operator: context.operator,
  workDate: context.workDate,
  shiftDate: context.shiftDate,
  previousWorkedDate: context.previousWorkedDate,
  schedule: context.schedule.map((day) => ({
    date: day.date,
    role: day.role.role,
    overtime: day.role.overtime,
    successor: day.successor,
    warnings: day.warnings,
  })),
  weeklyRecentRows: context.weeklyRecent.length,
  handoverRows: context.handoverRelevant.length,
  nextWeeklySequence: context.nextWeeklySequence,
}, null, 2));
