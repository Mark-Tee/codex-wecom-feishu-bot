export function validateDutySpec(spec) {
  const weeklyRows = spec.weeklyRows ?? [];
  const handoverRows = spec.handoverRows ?? [];
  if (!Array.isArray(weeklyRows) || !Array.isArray(handoverRows)) {
    throw new Error("draft-spec 必须包含 weeklyRows 和 handoverRows 数组");
  }
  weeklyRows.forEach((row, index) => {
    if (!Array.isArray(row) || row.length !== 17) {
      throw new Error(`weeklyRows[${index}] 必须包含 17 个值`);
    }
  });
  handoverRows.forEach((row, index) => {
    if (!Array.isArray(row) || row.length !== 9) {
      throw new Error(`handoverRows[${index}] 必须包含 9 个值`);
    }
  });
  return { weeklyRows: weeklyRows.length, handoverRows: handoverRows.length };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeWeeklyTitle(value, operator) {
  const title = String(value || "").trim();
  if (!title) return title;
  const names = [operator ? escapeRegExp(operator) : "", "我", "使用人(?:本人)?"].filter(Boolean);
  const pattern = new RegExp(
    `^([A-Za-z]\\d+-\\d+\\s*)?(?:网络一线[-\\s]*)?(?:陪同\\s*)?(?:${names.join("|")})\\s*(?:一起|去|前往)?\\s*`,
  );
  return title.replace(pattern, "$1").trim() || title;
}

export function normalizeCompletedCell(value) {
  const lines = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\d+[、.．]\s*/, ""))
    .filter(Boolean);
  return lines.map((line, index) => `${index + 1}、${line}`).join("\n");
}

export function normalizeDutySpec(spec, operator) {
  const normalized = structuredClone(spec);
  const normalizeTime = (value) => {
    const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})$/);
    return match ? `${match[1].padStart(2, "0")}:${match[2]}` : value;
  };
  for (const row of normalized.weeklyRows || []) {
    row[3] = normalizeWeeklyTitle(row[3], operator);
    row[12] = normalizeTime(row[12]);
    row[13] = normalizeTime(row[13]);
  }
  for (const row of normalized.handoverRows || []) {
    row[4] = String(row[4] || "")
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^\d+[、.．]\s*/, ""))
      .map((line) => normalizeWeeklyTitle(line, operator))
      .filter(Boolean)
      .map((line, index) => `${index + 1}、${line}`)
      .join("\n");
  }
  normalized.handoverRows = groupHandoverRows(normalized.handoverRows || []);
  return normalized;
}

export const handoverKey = row => JSON.stringify(row.slice(0, 4).map(v => String(v ?? "").trim()));

export function mergeHandoverRow(existing, incoming) {
  const row = existing.map(v => String(v ?? ""));
  for (const col of [4, 5]) {
    const lines = [row[col], incoming[col]].flatMap(value => String(value || "").split(/\r?\n/))
      .map(line => line.trim().replace(/^\d+[、.．]\s*/, "")).filter(Boolean);
    const unique = [...new Set(lines)];
    const meaningful = unique.length > 1 ? unique.filter(line => line !== "无") : unique;
    row[col] = meaningful.length === 1 && meaningful[0] === "无" ? "无"
      : meaningful.map((line, i) => `${i + 1}、${line}`).join("\n");
  }
  for (const col of [6, 7, 8]) {
    const next = String(incoming[col] ?? "").trim();
    if (next && row[col] && next !== row[col]) throw Error("同班次接班人、遗留说明或闭环状态不一致，需确认后汇总");
    if (next) row[col] = next;
  }
  return row;
}

export function groupHandoverRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 9 || row.slice(0, 4).some(v => !String(v ?? "").trim())) {
      throw Error("交接草稿需完整日期、条线、班次、交班人及9列数据，不能猜测合并");
    }
    const key = handoverKey(row);
    grouped.set(key, mergeHandoverRow(grouped.get(key) || [...row.slice(0, 4), "", "", "", "", ""], row));
  }
  return [...grouped.values()];
}

export function inferShiftDateFromSpec(spec, context = {}) {
  const handoverDate = String(spec.handoverRows?.[0]?.[0] || "").replaceAll("-", "");
  if (/^\d{8}$/.test(handoverDate)) return handoverDate;

  const raw = String(spec.weeklyRows?.[0]?.[5] || "").trim();
  const match = raw.match(/^(\d{1,2})[./-](\d{1,2})$/);
  if (!match) return String(context.shiftDate || "").replaceAll("-", "");
  let year = Number(String(context.workDate || context.shiftDate || "").slice(0, 4))
    || new Date().getFullYear();
  let date = new Date(Date.UTC(year, Number(match[1]) - 1, Number(match[2])));
  const base = String(context.workDate || context.shiftDate || "").replaceAll("-", "");
  if (base && Number(`${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`) - Number(base) > 180_000) {
    date = new Date(Date.UTC(year - 1, Number(match[1]) - 1, Number(match[2])));
  }
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}
