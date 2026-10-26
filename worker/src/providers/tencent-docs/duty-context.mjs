import { addDays, dateKey, resolveShiftDate, sheetForDate } from "../../core/duty-date.mjs";
import { classifyRole, colorMatches, findShiftPerson } from "../../core/duty-role.mjs";
import { parseCsv } from "../../core/draft-merge.mjs";

function columnName(index) {
  let value = index;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function rowRange(rowCount, colCount) {
  return `A1:${columnName(colCount)}${rowCount}`;
}

function stylesByRow(cells = []) {
  const rows = new Map();
  for (const cell of cells) {
    if (!rows.has(cell.row - 1)) rows.set(cell.row - 1, []);
    rows.get(cell.row - 1).push(cell);
  }
  return rows;
}

function previousWorkedDate({ rows, styles, headers, config, shiftDate }) {
  for (let offset = 1; offset <= 42; offset += 1) {
    const candidate = addDays(shiftDate, -offset);
    if (sheetForDate(candidate, "YYYYMM") !== sheetForDate(shiftDate, "YYYYMM")) break;
    const key = dateKey(candidate);
    const index = rows.findIndex((row) => String(row[0] || "").trim() === key);
    if (index < 0) break;
    const role = classifyRole({
      row: rows[index],
      styles: styles.get(index) || [],
      headers,
      config,
      nextStyles: styles.get(index + 1) || [],
    });
    if (role.role !== "rest" && role.role !== "ambiguous") return key;
  }
  return "";
}

export async function buildDutyContext({
  client,
  config,
  prompt,
  receivedAt,
  operator = "",
}) {
  const effective = operator ? { ...config, operator_name: operator } : config;
  if (effective.sources?.mode !== "online") {
    throw new Error("当前 Provider 只支持 sources.mode=online");
  }

  const shift = resolveShiftDate(prompt, receivedAt);
  const scheduleSource = effective.sources.online.schedule;
  const weeklySource = effective.sources.online.weekly;
  const handoverSource = effective.sources.online.handover;
  const [scheduleInfo, weeklyInfo, handoverInfo] = await Promise.all([
    client.getSheetInfo(scheduleSource),
    client.getSheetInfo(weeklySource),
    client.getSheetInfo(handoverSource),
  ]);

  const scheduleSheet = scheduleInfo.sheets.find(
    (sheet) => sheet.sheet_name === sheetForDate(shift.shiftDate, effective.schedule.sheet_format),
  );
  const weeklySheet = weeklyInfo.sheets.find(
    (sheet) => sheet.sheet_name === sheetForDate(shift.shiftDate, effective.weekly.sheet_format),
  );
  const handoverSheet = handoverInfo.sheets.find(
    (sheet) => sheet.sheet_name === sheetForDate(shift.shiftDate, effective.handover.sheet_format),
  );
  if (!scheduleSheet || !weeklySheet || !handoverSheet) {
    throw new Error("找不到对应日期的排班、周报或交接表");
  }

  const scheduleRowsCsv = await client.getCsv(
    scheduleSource,
    scheduleSheet.sheet_id,
    rowRange(scheduleSheet.row_count, scheduleSheet.col_count),
  );
  const scheduleRows = parseCsv(scheduleRowsCsv.csv_data || "");
  const headers = scheduleRows[0] || [];
  const dataRows = scheduleRows.slice(1);
  const allStyles = await client.getStyles(
    scheduleSource,
    scheduleSheet.sheet_id,
    `A1:${columnName(headers.length)}${scheduleSheet.row_count}`,
  );
  const styles = stylesByRow(allStyles.cells);

  const candidateDates = new Map(
    [shift.shiftDate, shift.workDate, ...shift.dates].map((date) => [dateKey(date), date]),
  );
  const dateRows = [...candidateDates.values()].slice(0, 3).map((date) => {
    const key = dateKey(date);
    const index = dataRows.findIndex((row) => String(row[0] || "").trim() === key);
    return { date: key, index, row: index >= 0 ? dataRows[index] : [] };
  }).filter((entry) => entry.index >= 0);

  const schedule = dateRows.map((entry) => {
    const rowStyles = styles.get(entry.index) || [];
    const nextStyles = styles.get(entry.index + 1) || [];
    const role = shift.start
      ? classifyRole({ row: entry.row, styles: rowStyles, headers, config: effective, nextStyles })
      : { role: "check-schedule", reason: "OCR 未提取到开始时间，需结合图片判断日期" };
    let successor = "";
    if (role.role === "white_primary") {
      successor = findShiftPerson({
        row: entry.row,
        styles: rowStyles,
        headers,
        config: effective,
        shift: "night",
        auxiliaryHeader: effective.line.aux_column_header,
      });
    } else if (role.role === "night_primary") {
      const nextRow = dataRows[entry.index + 1] || [];
      successor = findShiftPerson({
        row: nextRow,
        styles: nextStyles,
        headers,
        config: effective,
        shift: "white",
        auxiliaryHeader: effective.line.aux_column_header,
      });
    }
    const auxIndex = headers.indexOf(effective.line.aux_column_header);
    const auxValue = auxIndex >= 0 ? String(entry.row[auxIndex] || "").trim() : "";
    const holiday = colorMatches(rowStyles.find((cell) => cell.col === 0)?.background_color, "FF92D050");
    return {
      date: entry.date,
      role,
      successor,
      warnings: holiday && auxValue ? [`法定节假日网络辅值应为空，当前为：${auxValue}`] : [],
      cells: headers.map((header, index) => ({
        header,
        value: entry.row[index] || "",
        fill: rowStyles.find((cell) => cell.col === index)?.background_color || "",
      })).filter((cell) => cell.value || cell.fill),
    };
  });

  const weeklyCsv = await client.getCsv(
    weeklySource,
    weeklySheet.sheet_id,
    `A1:Q${weeklySheet.row_count}`,
  );
  const weeklyAll = parseCsv(weeklyCsv.csv_data || "");
  const weeklyRecent = weeklyAll
    .filter((row) => row.some((value) => String(value || "").trim() !== ""))
    .slice(-30);
  const nextWeeklySequence = weeklyRecent
    .map((row) => Number(String(row[0] || "").trim()))
    .filter(Number.isFinite)
    .reduce((maximum, value) => Math.max(maximum, value), 0) + 1;

  const handoverCsv = await client.getCsv(
    handoverSource,
    handoverSheet.sheet_id,
    `A1:I${handoverSheet.row_count}`,
  );
  const handoverRows = parseCsv(handoverCsv.csv_data || "").slice(1)
    .filter((row) => String(row[1] || "").trim() === effective.line.name);
  const relevantDates = new Set([dateKey(shift.shiftDate), dateKey(addDays(shift.shiftDate, -1))]);
  const handoverRelevant = handoverRows
    .filter((row) => relevantDates.has(String(row[0] || "").trim()))
    .slice(0, 8);
  const handoverPrior = handoverRows
    .filter((row) => String(row[0] || "").trim() < dateKey(shift.shiftDate))
    .slice(-1);

  return {
    receivedAt,
    operator: effective.operator_name,
    workDate: dateKey(shift.workDate),
    shiftDate: dateKey(shift.shiftDate),
    shiftDateSource: shift.dateSource,
    previousWorkedDate: previousWorkedDate({
      rows: dataRows,
      styles,
      headers,
      config: effective,
      shiftDate: shift.shiftDate,
    }),
    config: {
      operator: effective.operator_name,
      line: effective.line.name,
      teamMembers: effective.line.team_members,
      auxiliaryHeader: effective.line.aux_column_header,
      shiftTimes: effective.schedule.shift_times,
      defaults: effective.defaults,
      requesterRules: {
        networkSelfOperationRequester: "网络一线",
        networkSelfOperationPublisher: "网络一线",
        networkTeamMembers: effective.line.team_members,
      },
      completionRules: {
        completedWhen: "收到时间晚于工单开始时间",
        feedback: "已完成",
      },
      colorRules: {
        whitePrimary: "黄色FFFF00+白班",
        nightPrimary: "浅蓝B4C6E7+夜班",
        redRest: "红色或调休",
        greenRest: "绿色法定节假日",
        whiteContinuation: "纯白空白延续至08:30，之后休息",
      },
      holidayRules: {
        noAuxiliary: true,
        networkNotificationOnlyFor: "white_primary",
        networkNotification: effective.handover.holiday_notification || {
          workLocation: effective.defaults.work_location,
          taskType: "其他临时工作",
          title: "网络通报",
          urgent: "否",
          duration: "2h",
          requester: effective.defaults.requester,
          publisher: effective.defaults.publisher,
          recurring: "否",
          overtime: "是",
          start: "09:00",
          end: "15:00",
          feedback: "已完成",
          actualDuration: "6时00分",
        },
      },
      inspectionText: effective.handover.inspection_text,
    },
    schedule,
    weeklyHeader: weeklyAll.slice(0, 2),
    weeklyRecent,
    nextWeeklySequence,
    handoverRelevant,
    handoverPrior,
  };
}
