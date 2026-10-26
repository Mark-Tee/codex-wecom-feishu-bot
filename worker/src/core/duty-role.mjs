export function colorMatches(value, expected) {
  const actual = String(value || "").toUpperCase();
  const wanted = String(expected || "").replace(/^#/, "").toUpperCase();
  return Boolean(wanted) && actual.endsWith(wanted);
}

function cellFill(styles, col) {
  return styles.find((cell) => cell.col === col)?.background_color || "";
}

export function classifyRole({ row, styles, headers, config, nextStyles = [] }) {
  const operator = config.operator_name;
  const operatorIndex = headers.indexOf(operator);
  const auxiliaryHeader = config.line?.aux_column_header || "";
  const auxIndex = headers.indexOf(auxiliaryHeader);
  if (operatorIndex < 0 || auxIndex < 0) {
    return { role: "ambiguous", reason: "找不到使用人或网络辅值列" };
  }

  const value = String(row[operatorIndex] || "").trim();
  const fill = cellFill(styles, operatorIndex);
  const dateFill = cellFill(styles, 0);
  const nextDateFill = cellFill(nextStyles, 0);
  const holiday = colorMatches(dateFill, "FF92D050");
  const nextHoliday = colorMatches(nextDateFill, "FF92D050");
  const whiteValue = value === config.schedule.primary_white_value;
  const nightValue = value === config.schedule.primary_night_value;
  const whitePrimaryFill = colorMatches(fill, config.schedule.primary_white_fill);
  const nightPrimaryFill = colorMatches(fill, config.schedule.primary_night_fill);
  const ordinaryWhiteFill = colorMatches(fill, "00000000") || colorMatches(fill, "FFFFFFFF");
  const auxiliaryMatch = String(row[auxIndex] || "").trim() === operator;

  if (auxiliaryMatch && holiday) {
    return { role: "ambiguous", reason: "法定节假日网络辅值列不应有人" };
  }
  if (auxiliaryMatch && (whitePrimaryFill || nightPrimaryFill)) {
    return { role: "ambiguous", reason: "网络辅值与主值班次冲突" };
  }
  if (auxiliaryMatch) {
    return { role: "white_auxiliary", overtime: holiday };
  }
  if (whiteValue && whitePrimaryFill) {
    return { role: "white_primary", overtime: holiday };
  }
  if (whiteValue && ordinaryWhiteFill && !holiday) {
    return { role: "other_working", overtime: false };
  }
  if (whiteValue) {
    return { role: "ambiguous", reason: "白班颜色无法区分主值或其他角色" };
  }
  if (nightValue && nightPrimaryFill) {
    return { role: "night_primary", overtime: holiday || nextHoliday };
  }
  if (nightValue) {
    return { role: "ambiguous", reason: "夜班单元格不是配置的浅蓝色" };
  }
  if (value === "调休" || colorMatches(fill, "FF0000")) {
    return { role: "rest", restKind: "compensatory" };
  }
  if (colorMatches(fill, "FF92D050")) {
    return { role: "rest", restKind: "statutory-holiday" };
  }
  if (!value && colorMatches(fill, "FFFFFFFF")) {
    return { role: "rest", restKind: "night-continuation-after-08:30" };
  }
  if (!value && ordinaryWhiteFill) {
    return { role: "rest", restKind: "not-scheduled" };
  }
  return { role: "ambiguous", reason: `无法识别的排班：值=${value || "空"}，颜色=${fill || "空"}` };
}

export function findShiftPerson({ row, styles, headers, config, shift, auxiliaryHeader }) {
  const value = shift === "white"
    ? config.schedule.primary_white_value
    : config.schedule.primary_night_value;
  const fill = shift === "white"
    ? config.schedule.primary_white_fill
    : config.schedule.primary_night_fill;
  for (const name of config.line.team_members) {
    const index = headers.indexOf(name);
    if (index < 0 || headers[index] === auxiliaryHeader) continue;
    if (String(row[index] || "").trim() === value && colorMatches(cellFill(styles, index), fill)) {
      return name;
    }
  }
  return "";
}
