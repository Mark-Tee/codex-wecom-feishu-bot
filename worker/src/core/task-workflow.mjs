const SHANGHAI_TIME_ZONE = "Asia/Shanghai";
const DAY_START_MINUTES = 8 * 60 + 30;
const NIGHT_START_MINUTES = 17 * 60 + 30;
export const SCAN_BUFFER_MINUTES = 25;

const TASK_NUMBER_PATTERN = /^(WD|WN)(\d{8})(\d{3,})$/;
const IDENTITY_FIELDS = [
  ["location", "任务地点"],
  ["source", "任务来源"],
  ["transactionNo", "事务单号"],
  ["roomTicketNo", "机房单号"],
  ["workContent", "工作内容"],
  ["specificWork", "具体工作"],
  ["workDate", "任务日期"],
];

function toDate(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === "number") {
    return new Date(value < 1_000_000_000_000 ? value * 1000 : value);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`无效时间：${value}`);
  return date;
}

function shanghaiParts(value) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(toDate(value));
  const part = (type) => Number(parts.find((item) => item.type === type)?.value);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
  };
}

function dateKey(parts) {
  return [
    parts.year,
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("");
}

function shiftDateKey(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("");
}

export function resolveTaskShift(at) {
  const parts = shanghaiParts(at);
  const minutes = parts.hour * 60 + parts.minute;
  const today = dateKey(parts);
  if (minutes >= DAY_START_MINUTES && minutes < NIGHT_START_MINUTES) {
    return { code: "WD", date: today, prefix: `WD${today}`, kind: "白班" };
  }
  const nightDate = minutes < DAY_START_MINUTES ? shiftDateKey(parts, -1) : today;
  return { code: "WN", date: nightDate, prefix: `WN${nightDate}`, kind: "夜班" };
}

export function parseExpectedEnterAt(value) {
  const match = String(value || "").trim().match(
    /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?\s+(\d{1,2}):(\d{2})$/,
  );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    || hour > 23
    || minute > 59
  ) {
    return null;
  }
  const dateStamp = [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return {
    iso: `${dateStamp}T${time}:00+08:00`,
    date: dateStamp.replaceAll("-", "/"),
    time,
  };
}

export function resolveTaskShiftForWorkOrder({
  expectedEnterAt = "",
  receivedAt = new Date(),
} = {}) {
  const parsed = parseExpectedEnterAt(expectedEnterAt);
  return resolveTaskShift(parsed?.iso || receivedAt);
}

export function parseTaskNumber(value) {
  const match = String(value || "").trim().match(TASK_NUMBER_PATTERN);
  if (!match) return null;
  return {
    code: match[1],
    date: match[2],
    sequence: Number(match[3]),
    prefix: `${match[1]}${match[2]}`,
  };
}

export function taskNumberToShortId(value) {
  const parsed = parseTaskNumber(value);
  if (!parsed) return "";
  const lastThreeDigits = String(parsed.sequence).padStart(3, "0").slice(-3);
  return String(Number(lastThreeDigits));
}

export function nextTaskNumber(taskNumbers, prefix) {
  const normalizedPrefix = String(prefix || "").trim().toUpperCase();
  if (!/^(WD|WN)\d{8}$/.test(normalizedPrefix)) {
    throw new Error(`无效任务号前缀：${prefix}`);
  }
  let maximum = 0;
  for (const value of taskNumbers) {
    const parsed = parseTaskNumber(value);
    if (parsed?.prefix === normalizedPrefix) maximum = Math.max(maximum, parsed.sequence);
  }
  return `${normalizedPrefix}${String(maximum + 1).padStart(3, "0")}`;
}

function normalizeIdentityValue(field, value) {
  let result = String(value ?? "").trim();
  if (field === "transactionNo" || field === "roomTicketNo") {
    result = result.replace(/\s+/g, "").toUpperCase();
  }
  if (field === "workDate") {
    const match = result.match(/^(20\d{2})[-/.年]?(\d{1,2})[-/.月]?(\d{1,2})日?$/);
    if (match) {
      result = `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
    }
  }
  return result;
}

export function compareTaskIdentity(recognized, existing) {
  const mismatches = [];
  for (const [field, label] of IDENTITY_FIELDS) {
    const recognizedValue = normalizeIdentityValue(field, recognized?.[field]);
    if (!recognizedValue) continue;
    const existingValue = normalizeIdentityValue(field, existing?.[field]);
    if (recognizedValue !== existingValue) {
      mismatches.push({
        field,
        label,
        recognized: String(recognized?.[field] ?? "").trim(),
        feishu: String(existing?.[field] ?? "").trim(),
      });
    }
  }
  return { exact: mismatches.length === 0, mismatches };
}

function normalizePeople(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.flatMap((item) => {
    const raw = typeof item === "string"
      ? item
      : item?.name || item?.text || item?.displayName || "";
    return String(raw)
      .split(/[,，、;；\n]+/)
      .map((name) => name.trim())
      .filter(Boolean);
  }))];
}

function normalizeScanRecord(record) {
  const people = normalizePeople(record.person);
  if (people.length !== 1) {
    throw new Error("每条扫码记录必须且只能对应一名人员");
  }
  const enteredAt = toDate(record.enteredAt);
  const leftAt = toDate(record.leftAt);
  if (leftAt < enteredAt) throw new Error(`${people[0]} 的离开时间早于进入时间`);
  return {
    person: people[0],
    enteredAt,
    leftAt,
    source: record.source || "机房内",
  };
}

function mergeIntervals(intervals) {
  const sorted = [...intervals].sort((a, b) => a.enteredAt - b.enteredAt);
  const merged = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval.enteredAt > previous.leftAt) {
      merged.push({ ...interval });
    } else if (interval.leftAt > previous.leftAt) {
      previous.leftAt = interval.leftAt;
    }
  }
  return merged;
}

export function calculateScanWorkload(records, { bufferMinutes = SCAN_BUFFER_MINUTES } = {}) {
  if (!records.length) throw new Error("没有可用于统计的扫码记录");
  const intervals = records.map(normalizeScanRecord);
  const people = new Map();
  for (const interval of intervals) {
    if (!people.has(interval.person)) people.set(interval.person, []);
    people.get(interval.person).push(interval);
  }

  const personRows = [...people.entries()].map(([person, ownIntervals]) => {
    const merged = mergeIntervals(ownIntervals);
    const durationMs = merged.reduce(
      (sum, interval) => sum + (interval.leftAt - interval.enteredAt),
      0,
    );
    return {
      person,
      firstEnteredAt: merged[0].enteredAt.toISOString(),
      lastLeftAt: merged.at(-1).leftAt.toISOString(),
      intervalCount: merged.length,
      durationMinutes: Math.floor(durationMs / 60_000),
      workloadMinutes: Math.floor(durationMs / 60_000) + bufferMinutes,
      intervals: merged.map((interval) => ({
        enteredAt: interval.enteredAt.toISOString(),
        leftAt: interval.leftAt.toISOString(),
        source: interval.source,
      })),
    };
  }).sort((a, b) => new Date(a.firstEnteredAt) - new Date(b.firstEnteredAt));

  const firstEnteredAt = new Date(Math.min(...intervals.map((item) => item.enteredAt)));
  const lastLeftAt = new Date(Math.max(...intervals.map((item) => item.leftAt)));
  const durationMinutes = Math.floor((lastLeftAt - firstEnteredAt) / 60_000);
  return {
    firstEnteredAt: firstEnteredAt.toISOString(),
    lastLeftAt: lastLeftAt.toISOString(),
    durationMinutes,
    bufferedDurationMinutes: durationMinutes + bufferMinutes,
    bufferMinutes,
    people: personRows,
  };
}

export function chooseAssignee(records, { allowMultiple = false } = {}) {
  const firstEntryByPerson = new Map();
  for (const record of records) {
    const owners = normalizePeople(record.person);
    if (owners.length !== 1) throw new Error("扫码记录人员不唯一");
    const enteredAt = toDate(record.enteredAt).getTime();
    const previous = firstEntryByPerson.get(owners[0]);
    if (previous == null || enteredAt < previous) firstEntryByPerson.set(owners[0], enteredAt);
  }
  const ordered = [...firstEntryByPerson.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([person]) => person);
  return allowMultiple ? ordered : ordered.slice(0, 1);
}
