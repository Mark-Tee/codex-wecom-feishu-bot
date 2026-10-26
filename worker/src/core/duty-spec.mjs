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
    `^(?:[A-Za-z]\\d+-\\d+\\s*)?(?:网络一线[-\\s]*)?(?:陪同\\s*)?(?:${names.join("|")})\\s*(?:一起|去|前往)?\\s*`,
  );
  return title.replace(pattern, "").trim() || title;
}

function normalizeHandoverTitle(value, operator, selfActionTitles) {
  const line = String(value || "").trim();
  if (!line || !operator) return line;
  const pattern = new RegExp(
    `^(?:[A-Za-z]\\d+-\\d+\\s*)?(?:网络一线[-\\s]*)?(?:陪同\\s*)?(?:${escapeRegExp(operator)}|我|使用人(?:本人)?)\\s*(?:一起|去|前往)?\\s*`,
  );
  if (pattern.test(line)) return `${operator}${line.replace(pattern, "").trim()}`;
  if (line.startsWith(operator)) return line;
  return selfActionTitles.has(line) ? `${operator}${line}` : line;
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
  const selfActionTitles = new Set(
    (normalized.weeklyRows || [])
      .filter((row) => String(row[7]).trim() === "网络一线" && String(row[8]).trim() === "网络一线")
      .map((row) => String(row[3]).trim())
      .filter(Boolean),
  );
  for (const row of normalized.handoverRows || []) {
    row[4] = String(row[4] || "")
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^\d+[、.．]\s*/, ""))
      .map((line) => normalizeHandoverTitle(line, operator, selfActionTitles))
      .filter(Boolean)
      .map((line, index) => `${index + 1}、${line}`)
      .join("\n");
  }
  return normalized;
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
