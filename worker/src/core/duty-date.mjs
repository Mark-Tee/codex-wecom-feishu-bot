const NIGHT_END_MINUTES = 8 * 60 + 30;

export function dateKey(date) {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

export function addDays(date, days) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + days,
  ));
}

export function shanghaiDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`无效的接收时间：${value}`);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type) => Number(parts.find((item) => item.type === type)?.value);
  return new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
}

export function extractDates(text, fallback) {
  const found = [];
  const source = String(text || "");
  for (const match of source.matchAll(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/g)) {
    found.push(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
  }
  for (const match of source.matchAll(/\b(20\d{2})(\d{2})(\d{2})\b/g)) {
    found.push(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
  }
  for (const match of source.matchAll(/(\d{1,2})月(\d{1,2})日/g)) {
    found.push(new Date(Date.UTC(
      fallback.getUTCFullYear(),
      Number(match[1]) - 1,
      Number(match[2]),
    )));
  }
  const unique = new Map();
  for (const date of [...found, fallback, addDays(fallback, -1)]) {
    if (!Number.isNaN(date.getTime())) unique.set(dateKey(date), date);
  }
  return [...unique.values()];
}

export function extractWorkStart(text) {
  const dated = [];
  const source = String(text || "");
  for (const match of source.matchAll(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?\s*(\d{1,2}):(\d{2})/g)) {
    const date = new Date(Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
    ));
    dated.push({
      timestamp: date.getTime(),
      date,
      minutes: Number(match[4]) * 60 + Number(match[5]),
    });
  }
  if (dated.length) return dated.sort((a, b) => a.timestamp - b.timestamp)[0];

  const clock = source.match(/预计进入时间[:：]?\s*(\d{1,2}):(\d{2})/);
  if (!clock) return null;
  return {
    timestamp: null,
    date: null,
    minutes: Number(clock[1]) * 60 + Number(clock[2]),
  };
}

export function resolveShiftDate(text, receivedAt) {
  const fallback = shanghaiDate(receivedAt);
  const dates = extractDates(text, fallback);
  const start = extractWorkStart(text);
  const workDate = start?.date || dates[0];
  const shiftDate = start && start.minutes < NIGHT_END_MINUTES
    ? addDays(workDate, -1)
    : workDate;
  return {
    dates,
    workDate,
    shiftDate,
    start,
    dateSource: start ? "work-order-time" : "fallback-requires-image-check",
  };
}

export function sheetForDate(date, format) {
  const stamp = dateKey(date);
  if (format === "YYYYMM") return stamp.slice(0, 6);
  if (format === "M月") return `${date.getUTCMonth() + 1}月`;
  throw new Error(`不支持的工作表格式：${format}`);
}
