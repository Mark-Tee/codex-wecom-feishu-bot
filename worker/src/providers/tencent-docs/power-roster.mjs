import fs from "node:fs/promises";
import path from "node:path";
import { resolveTaskShift } from "../../core/task-workflow.mjs";
import { parseCsv } from "../../core/draft-merge.mjs";

export const POWER_HEADERS = Object.freeze({ white: "动力白班值班人员", night: "动力夜班值班人员" });

export function powerDutyFromRows(rows, { receivedAt, operator }) {
  const shift = resolveTaskShift(receivedAt);
  const headers = (rows[0] || []).map((value) => String(value).trim());
  const dateIndex = headers.indexOf("日期");
  const nameIndex = headers.indexOf(shift.kind === "白班" ? POWER_HEADERS.white : POWER_HEADERS.night);
  if (dateIndex < 0 || nameIndex < 0) throw new Error("在线排班表缺少日期或动力值班人员列，不能自动判断");
  const matches = rows.slice(1).filter((row) => String(row[dateIndex] || "").trim() === shift.date);
  if (matches.length !== 1) throw new Error(`动力值班排班 ${shift.date} 缺失或重复，请核对在线表`);
  const names = String(matches[0][nameIndex] || "").split(/[、,，;；/\s]+/u).filter(Boolean);
  if (!names.length) throw new Error(`动力${shift.kind} ${shift.date} 人员为空，请核对在线表`);
  if (!String(operator || "").trim()) throw new Error("未确定当前使用人，不能判断动力值班");
  return { matched: names.includes(String(operator).trim()), date: shift.date, kind: shift.kind };
}

export async function readPowerRoster({ client, config, receivedAt, operator, cachePath }) {
  const source = config.sources?.online?.schedule;
  if (config.sources?.mode !== "online" || !source) throw new Error("动力值班需要配置在线排班表");
  const info = await client.getSheetInfo(source);
  const shift = resolveTaskShift(receivedAt);
  const sheet = info.sheets.find((item) => item.sheet_name === shift.date.slice(0, 6));
  if (!sheet) throw new Error(`找不到动力值班排班工作表 ${shift.date.slice(0, 6)}`);
  let n = Number(sheet.col_count);
  if (!Number.isSafeInteger(n) || n < 1 || !Number.isSafeInteger(Number(sheet.row_count)) || Number(sheet.row_count) < 1) {
    throw new Error("在线排班表行列数无效");
  }
  let end = "";
  while (n > 0) { end = String.fromCharCode(65 + (n - 1) % 26) + end; n = Math.floor((n - 1) / 26); }
  const data = await client.getCsv(source, sheet.sheet_id, `A1:${end}${sheet.row_count}`);
  if (typeof data.csv_data !== "string") throw new Error("在线排班表未返回 CSV，停止使用缓存");
  const rows = parseCsv(data.csv_data);
  const role = powerDutyFromRows(rows, { receivedAt, operator });
  const headers = (rows[0] || []).map((value) => String(value).trim());
  const snapshot = {
    fetchedAt: new Date().toISOString(), sheet: sheet.sheet_name,
    rows: rows.slice(1).map((row) => ({
      date: row[headers.indexOf("日期")] || "",
      white: row[headers.indexOf(POWER_HEADERS.white)] || "",
      night: row[headers.indexOf(POWER_HEADERS.night)] || "",
    })).filter((row) => /^\d{8}$/.test(String(row.date))),
  };
  if (cachePath) {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    const temporary = `${cachePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
    await fs.rename(temporary, cachePath);
  }
  return { ...role, fetchedAt: snapshot.fetchedAt };
}
