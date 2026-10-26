export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length) {
    row.push(field);
    if (row.some((value) => value !== "")) rows.push(row);
  }
  return rows;
}

export function toCsv(rows) {
  return rows.map((row) => row.map((value) => {
    const text = value == null ? "" : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  }).join(",")).join("\n");
}

export function parseCompactDate(value, year) {
  const text = String(value || "").trim();
  if (/^\d{8}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})[./-](\d{1,2})$/);
  return match ? `${year}${match[1].padStart(2, "0")}${match[2].padStart(2, "0")}` : "";
}

export function normalizeRow(row, width) {
  return Array.from({ length: width }, (_, index) => row[index] ?? "");
}

function completedLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\d+[、.．]\s*/, ""))
    .filter(Boolean);
}

export function mergeCompleted(existingValue, incomingValue) {
  const existing = completedLines(existingValue);
  const pending = new Map();
  existing.forEach((line) => pending.set(line, (pending.get(line) || 0) + 1));
  const merged = [...existing];
  for (const line of completedLines(incomingValue)) {
    const count = pending.get(line) || 0;
    if (count > 0) pending.set(line, count - 1);
    else merged.push(line);
  }
  return merged.map((line, index) => `${index + 1}、${line}`).join("\n");
}

export function mergeDraftRows({
  weeklyExisting,
  handoverExisting,
  weeklyIncoming,
  handoverIncoming,
  currentDate,
  previousDate,
  year,
}) {
  const keepDates = new Set([currentDate, previousDate].filter(Boolean));
  const retainAll = !/^\d{8}$/.test(previousDate || "");
  const weeklyHeader = weeklyExisting[0]?.length
    ? normalizeRow(weeklyExisting[0], 17)
    : ["序号", "工作地", "任务类型", "任务描述", "紧急", "日期", "预计耗时", "需求人", "发布人", "责任人", "周期任务", "加班", "任务开始时间", "任务结束时间", "任务反馈", "问题", "任务总耗时"];
  const handoverHeader = handoverExisting[0]?.length
    ? normalizeRow(handoverExisting[0], 9)
    : ["日期", "条线", "班次", "交班值班姓名", "当班已完成工作", "当班未完成工作", "接班值班姓名", "遗留工作完成情况说明", "是否闭环"];

  const weeklyRows = weeklyExisting.slice(1)
    .map((row) => normalizeRow(row, 17))
    .filter((row) => retainAll || keepDates.has(parseCompactDate(row[5], year)));
  const weeklyKeys = new Set(weeklyRows.map((row) => `${parseCompactDate(row[5], year)}|${String(row[3]).trim()}`));
  const usedSequences = new Set(
    weeklyRows.map((row) => Number(String(row[0]).trim())).filter(Number.isFinite),
  );
  let maxSequence = Math.max(0, ...usedSequences);
  for (const incoming of weeklyIncoming.map((row) => normalizeRow(row, 17))) {
    const date = parseCompactDate(incoming[5], year);
    const key = `${date}|${String(incoming[3]).trim()}`;
    if (!keepDates.has(date) || weeklyKeys.has(key)) continue;
    const sequence = Number(String(incoming[0]).trim());
    if (!Number.isFinite(sequence) || usedSequences.has(sequence)) {
      maxSequence += 1;
      incoming[0] = String(maxSequence);
    } else maxSequence = Math.max(maxSequence, sequence);
    usedSequences.add(Number(incoming[0]));
    weeklyRows.push(incoming);
    weeklyKeys.add(key);
  }

  const handoverRows = handoverExisting.slice(1)
    .map((row) => normalizeRow(row, 9))
    .filter((row) => retainAll || keepDates.has(String(row[0]).trim()));
  const handoverMap = new Map(
    handoverRows.map((row) => [`${row[0]}|${row[1]}|${row[2]}|${row[3]}`, row]),
  );
  for (const incoming of handoverIncoming.map((row) => normalizeRow(row, 9))) {
    const date = String(incoming[0]).trim();
    if (!keepDates.has(date)) continue;
    const key = `${incoming[0]}|${incoming[1]}|${incoming[2]}|${incoming[3]}`;
    const existing = handoverMap.get(key);
    if (!existing) {
      incoming[4] = mergeCompleted("", incoming[4]);
      handoverMap.set(key, incoming);
      continue;
    }
    existing[4] = mergeCompleted(existing[4], incoming[4]);
    [5, 6, 7, 8].forEach((index) => {
      if (String(incoming[index]).trim()) existing[index] = incoming[index];
    });
  }

  return {
    weeklyHeader,
    handoverHeader,
    weeklyRows,
    handoverRows: [...handoverMap.values()]
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    keptDates: [...keepDates],
  };
}
