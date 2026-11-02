import { parseCsv } from "../../core/draft-merge.mjs";
import { rosterNames } from "../../core/roster-names.mjs";
import { auxiliaryPolicy } from "../../core/auxiliary-policy.mjs";
import { colorMatches } from "../../core/duty-role.mjs";
import { addDays, dateKey, shanghaiDate, sheetForDate } from "../../core/duty-date.mjs";

function column(n) {
  let result = "";
  while (n > 0) { result = String.fromCharCode(65 + (n - 1) % 26) + result; n = Math.floor((n - 1) / 26); }
  return result;
}
const clean = (value) => String(value).replace(/[\r\n<>`*_\[\]]/g, " ");

export function summarizeSchedule({ rows, styles, date, config }) {
  const headers = (rows[0] || []).map((v) => String(v).trim());
  const required = ["日期", "动力白班值班人员", "动力夜班值班人员"];
  const departments = config.site_rules?.departments || [];
  if (!config.site_rules?.enabled || !departments.length) throw new Error("排班播报需要完整部门配置");
  for (const group of departments) required.push(group.auxiliary_header, ...group.offsite_headers, ...group.members);
  for (const header of required) if (headers.filter((v) => v === header).length !== 1) throw new Error(`排班列缺失或重复：${header}`);
  const matches = rows.map((row, index) => ({ row, index })).slice(1).filter(({row}) => String(row[headers.indexOf("日期")]).trim() === date);
  if (matches.length !== 1) throw new Error(`排班日期缺失或重复：${date}`);
  const {row, index} = matches[0];
  // Provider styles use zero-based physical CSV row/column coordinates.
  const fills = styles.filter((cell) => cell.row === index);
  const fill = (header) => fills.find((cell) => cell.col === headers.indexOf(header))?.background_color;
  const get = (header) => rosterNames(row[headers.indexOf(header)]);
  const members = departments.flatMap((group) => group.members);
  if (new Set(members).size !== members.length) throw new Error("部门人员名单重复");
  const checked = (header, required = false) => {
    const names = get(header);
    if ((required && names.length !== 1) || new Set(names).size !== names.length || names.some((name) => !members.includes(name))) throw new Error(`岗位人员为空、重复或不在名单中：${header}`);
    if (names.some((name) => /^(?:调休|休假|休息|年假|事假|病假)$/.test(String(row[headers.indexOf(name)] || "").trim()))) throw new Error(`岗位与明确休假冲突：${header}`);
    return names;
  };
  const power = { white: checked("动力白班值班人员", true), night: checked("动力夜班值班人员", true) };
  const holiday = colorMatches(fill("日期"), "FF92D050");
  const auxiliary = auxiliaryPolicy({date, holiday});
  const offsiteNames = new Set();
  const warnings = [];
  const groups = departments.map((group) => {
    const offsite = [];
    for (const header of group.offsite_headers) for (const name of checked(header)) {
      if (!group.members.includes(name) || offsiteNames.has(name)) throw new Error("异地岗位重复或部门冲突");
      offsiteNames.add(name); offsite.push({name, slot: header});
    }
    const aux = checked(group.auxiliary_header);
    if (aux.length > 1 || aux.some((name) => !group.members.includes(name))) throw new Error("白班辅值人员冲突");
    if (!auxiliary.allowed && aux.length) warnings.push(`${group.name}辅值原表有人，本日规则不生效，待核对`);
    const main = (kind) => group.members.filter((name) => {
      const value = String(row[headers.indexOf(name)] || "").trim();
      const expected = kind === "white" ? config.schedule.primary_white_value : config.schedule.primary_night_value;
      const color = kind === "white" ? config.schedule.primary_white_fill : config.schedule.primary_night_fill;
      return value === expected && colorMatches(fill(name), color) && !offsiteNames.has(name);
    });
    const white = main("white"), night = main("night");
    if (white.length !== 1 || night.length !== 1) throw new Error(`${group.name}白班或夜班主值缺失、重复或颜色异常`);
    if (auxiliary.allowed && aux.some((name) => [...white, ...night, ...offsite.map((x) => x.name)].includes(name))) throw new Error("白班辅值与主值或异地岗位冲突");
    const occupied = new Set([...white, ...night, ...power.white, ...power.night, ...aux, ...offsite.map((x) => x.name)]);
    const standby = group.members.filter((name) => !occupied.has(name) && String(row[headers.indexOf(name)] || "").trim() === config.schedule.primary_white_value && ["00000000", "FFFFFFFF"].some((color) => colorMatches(fill(name), color)) && !holiday);
    return {name: group.name, white, night, auxiliary: auxiliary.allowed ? aux : null, offsite, offsiteRole: group.offsite_role, standby};
  });
  for (const name of [...power.white, ...power.night]) if (offsiteNames.has(name)) throw new Error("动力与异地岗位冲突");
  return {date, groups, power, warnings};
}

export async function readScheduleBroadcast({ client, config, at = new Date() }) {
  if (config.sources?.mode !== "online") throw new Error("排班播报仅支持在线表");
  const source = config.sources.online.schedule;
  const info = await client.getSheetInfo(source);
  const today = shanghaiDate(at);
  const cache = new Map();
  const days = [];
  for (const date of [today, addDays(today, 1)]) {
    const sheetName = sheetForDate(date, config.schedule.sheet_format);
    if (!cache.has(sheetName)) {
      const sheet = info.sheets.find((s) => s.sheet_name === sheetName);
      if (!sheet || !Number.isSafeInteger(Number(sheet.row_count)) || Number(sheet.row_count) < 1 || !Number.isSafeInteger(Number(sheet.col_count)) || Number(sheet.col_count) < 1) throw new Error(`排班工作表缺失或大小无效：${sheetName}`);
      const range = `A1:${column(Number(sheet.col_count))}${sheet.row_count}`;
      const csv = await client.getCsv(source, sheet.sheet_id, range);
      if (typeof csv.csv_data !== "string") throw new Error("实时排班读取失败，不使用缓存");
      const styleResult = await client.getStyles(source, sheet.sheet_id, range);
      if (!Array.isArray(styleResult.cells) || !styleResult.cells.length) throw new Error("排班颜色读取失败");
      const confirm = await client.getCsv(source, sheet.sheet_id, range);
      if (confirm.csv_data !== csv.csv_data) throw new Error("读取期间排班发生变化，下次重新核验");
      const confirmStyles = await client.getStyles(source, sheet.sheet_id, range);
      const fingerprint = (cells) => JSON.stringify(cells.map(({row,col,background_color}) => [row,col,background_color || ""]).sort((a,b) => a[0]-b[0] || a[1]-b[1]));
      if (!Array.isArray(confirmStyles.cells) || fingerprint(confirmStyles.cells) !== fingerprint(styleResult.cells)) throw new Error("读取期间岗位颜色变化，下次重新核验");
      cache.set(sheetName, {rows: parseCsv(csv.csv_data), styles: styleResult.cells});
    }
    days.push(summarizeSchedule({...cache.get(sheetName), date: dateKey(date), config}));
  }
  return {days, fetchedAt: new Date().toISOString(), home: config.site_rules.home_site, offsite: config.site_rules.offsite_site};
}

export function formatScheduleBroadcast(snapshot) {
  const names = (list) => list.map(clean).join("、") || "未安排";
  const lines = ["【今日 · 明日排班】"];
  snapshot.days.forEach((day, i) => {
    const date = new Date(`${day.date.slice(0,4)}-${day.date.slice(4,6)}-${day.date.slice(6,8)}T00:00:00Z`);
    lines.push("", `**${i === 0 ? "今天" : "明天"} ${day.date.slice(4,6)}/${day.date.slice(6,8)} 周${"日一二三四五六"[date.getUTCDay()]}**`);
    for (const group of day.groups) {
      lines.push(`${clean(group.name)}｜白班主值 ${names(group.white)} · 夜班主值 ${names(group.night)}`, `白班辅值：${group.auxiliary === null ? "无（周末/节假日）" : names(group.auxiliary)}`);
      if (group.offsite.length) lines.push(`${clean(snapshot.offsite)}${clean(group.offsiteRole)}：${group.offsite.map((p) => `${clean(p.name)}（${clean(p.slot)}）`).join("、")}`);
      if (group.standby.length) lines.push(`${clean(snapshot.home)}待命：${names(group.standby)}`);
    }
    lines.push(`动力｜白班 ${names(day.power.white)} · 夜班 ${names(day.power.night)}`);
    day.warnings.forEach((warning) => lines.push(`⚠ ${clean(warning)}`));
  });
  lines.push("", "白班08:30–17:30｜夜班17:30–次日08:30", "白班辅值09:00–15:00；08:30前仍属前一日夜班。", "岗位兼任按原表并列；待命仅按实际工单陪同。", `在线表读取：${new Date(snapshot.fetchedAt).toLocaleString("zh-CN", {timeZone:"Asia/Shanghai", hour12:false})}`, "发送后调班请以在线表为准，可@机器人发送“查看排班”重新读取。");
  const text = lines.join("\n");
  if (Buffer.byteLength(text, "utf8") > 3900) throw new Error("排班通知过长，停止发送以免截断");
  return text;
}
