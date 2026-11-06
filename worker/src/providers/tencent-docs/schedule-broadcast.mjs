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
const clean = (value) => String(value).replace(/（(?:原表空白，按排班规则|按前日夜班及空白排班)）/gu, "").replace(/[\r\n<>`*_\[\]]/g, " ");

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
  const calendarDate = new Date(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T00:00:00Z`);
  const previousDate = dateKey(addDays(calendarDate,-1));
  const previousRows = rows.slice(1).filter(item=>String(item[headers.indexOf("日期")] || "").trim()===previousDate);
  const previous = previousRows.length===1 ? previousRows[0] : null;
  const people = departments.flatMap((department) => department.members.map((name) => {
    const group = groups.find((item) => item.name === department.name);
    const raw = String(row[headers.indexOf(name)] || "").trim();
    const offsite = group.offsite.find((item) => item.name === name);
    const roles = [];
    if (offsite) roles.push(`${raw || "当日"}·${department.offsite_role}（${offsite.slot}）`);
    else {
      if (group.white.includes(name)) roles.push("白班主值");
      if (group.night.includes(name)) roles.push("夜班主值");
      if (group.auxiliary?.includes(name)) roles.push("白班辅值");
      if (group.standby.includes(name)) roles.push("白班待命");
    }
    const homeRole = roles.length > 0 && !offsite;
    if (power.white.includes(name)) roles.push("动力白班");
    if (power.night.includes(name)) roles.push("动力夜班");
    const blankRest = !raw && !roles.length;
    const afterNight = previous && (String(previous[headers.indexOf(name)] || "").trim()===config.schedule.primary_night_value || rosterNames(previous[headers.indexOf("动力夜班值班人员")]).includes(name));
    const restReason = blankRest ? afterNight ? "下夜班休息（按前日夜班及空白排班）" : [0,6].includes(calendarDate.getUTCDay()) ? "周末休息（原表空白，按排班规则）" : "休息（原表空白，按排班规则）" : "";
    const leave = /^(?:调休|休假|休息|年假|事假|病假)$/.test(raw) || blankRest;
    if (leave) roles.push(restReason || raw);
    if (!roles.length) roles.push(raw ? `${raw}（岗位待核对）` : "原表空白，需结合前夜排班核对");
    const shiftKind=raw===config.schedule.primary_white_value ? "white" : raw===config.schedule.primary_night_value ? "night" : "";
    return {name, department:department.name, roles, site:offsite ? config.site_rules.offsite_site : homeRole ? config.site_rules.home_site : "", leave, restReason, shiftKind, offsite:Boolean(offsite)};
  }));
  return {date, groups, power, warnings, people};
}

export async function readScheduleSheet({client,config,source,sheet,dates}) {
  if (!sheet || !Number.isSafeInteger(Number(sheet.row_count)) || Number(sheet.row_count)<1 || !Number.isSafeInteger(Number(sheet.col_count)) || Number(sheet.col_count)<1)throw Error("排班工作表缺失或大小无效");
  const range=`A1:${column(Number(sheet.col_count))}${sheet.row_count}`;
  const csv=await client.getCsv(source,sheet.sheet_id,range);
  if(typeof csv.csv_data!=="string")throw Error("实时排班读取失败，不使用缓存");
  const styleResult=await client.getStyles(source,sheet.sheet_id,range);
  if(!Array.isArray(styleResult.cells)||!styleResult.cells.length)throw Error("排班颜色读取失败");
  const confirm=await client.getCsv(source,sheet.sheet_id,range);
  if(confirm.csv_data!==csv.csv_data)throw Error("读取期间排班发生变化，下次重新核验");
  const confirmStyles=await client.getStyles(source,sheet.sheet_id,range);
  const rows=parseCsv(csv.csv_data,{preserveEmptyRows:true}),dateColumn=rows[0]?.indexOf("日期")??-1;
  if(dateColumn<0)throw Error("排班表缺少日期列");
  const wanted=new Set(dates),relevantRows=new Set(rows.map((row,index)=>wanted.has(String(row[dateColumn]).trim())?index:-1));
  const relevantColumns=new Set([dateColumn,...config.site_rules.departments.flatMap(group=>group.members.map(name=>rows[0].indexOf(name)))]);
  const fingerprint=cells=>JSON.stringify(cells.filter(cell=>relevantRows.has(cell.row)&&relevantColumns.has(cell.col)).map(({row,col,background_color})=>[row,col,background_color||""]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]));
  if(!Array.isArray(confirmStyles.cells)||fingerprint(confirmStyles.cells)!==fingerprint(styleResult.cells))throw Error("读取期间岗位颜色变化，下次重新核验");
  return {rows,styles:styleResult.cells};
}

export async function readScheduleBroadcast({ client, config, at = new Date(), offsets = [0, 1] }) {
  if (config.sources?.mode !== "online") throw new Error("排班播报仅支持在线表");
  const source = config.sources.online.schedule;
  const info = await client.getSheetInfo(source);
  const today = shanghaiDate(at);
  const cache = new Map();
  const days = [];
  for (const offset of offsets) {
    const date = addDays(today, offset);
    const sheetName = sheetForDate(date, config.schedule.sheet_format);
    if (!cache.has(sheetName)) {
      const sheet = info.sheets.find((s) => s.sheet_name === sheetName);
      cache.set(sheetName,await readScheduleSheet({client,config,source,sheet,dates:offsets.map(value=>dateKey(addDays(today,value)))}));
    }
    days.push({...summarizeSchedule({...cache.get(sheetName), date: dateKey(date), config}), label:offset === 0 ? "今天" : "明天"});
  }
  return {days, fetchedAt: new Date().toISOString(), home: config.site_rules.home_site, offsite: config.site_rules.offsite_site};
}

export function formatScheduleBroadcast(snapshot, {viewer = ""} = {}) {
  const names = (list) => list.map(clean).join("、") || "未安排";
  const peopleLines = (label, list) => {
    let line = `${label}：`;
    for (const person of list.map(clean)) {
      const separator = line.endsWith("：") ? "" : "、";
      // Use text width, not padding or a Markdown table, for narrow phone bubbles.
      const width = (text) => [...text].reduce((sum,c) => sum + (c.charCodeAt(0) > 255 ? 2 : 1),0);
      if (width(line + separator + person) > 36 && !line.endsWith("：")) { lines.push(line); line = `${label}（续）：${person}`; }
      else line += separator + person;
    }
    lines.push(line);
  };
  const lines = [snapshot.days.length === 1 ? `【${snapshot.days[0].label === "明天" ? "次日" : "今日"}排班】` : "【今日 · 明日排班】"];
  const person = snapshot.days[0].people?.find((item) => item.name === viewer);
  if (person) {
    lines.push("", `**你的排班｜${clean(viewer)} · ${clean(person.department)}**`);
    snapshot.days.forEach((day, i) => {
      const own = day.people?.find((item) => item.name === viewer);
      const label = day.label || (i === 0 ? "今天" : "明天");
      if (!own) lines.push(`${label}：身份不在名单，待核对`);
      else if (own.site) {
        lines.push(`${label}：${clean(own.site)}`);
        for (const role of own.roles) lines.push(clean(role));
      } else lines.push(`${label}：${names(own.roles)}`);
    });
  } else if (viewer) lines.push("", "个人身份不在本次排班名单中，以下按全员视角展示，请核对排班身份。");
  snapshot.days.forEach((day, i) => {
    const date = new Date(`${day.date.slice(0,4)}-${day.date.slice(4,6)}-${day.date.slice(6,8)}T00:00:00Z`);
    lines.push("", `**${day.label || (i === 0 ? "今天" : "明天")} ${day.date.slice(4,6)}/${day.date.slice(6,8)} 周${"日一二三四五六"[date.getUTCDay()]}**`);
    const own = day.people?.find((item) => item.name === viewer);
    const groups = [...day.groups].sort((a,b) => Number(b.name === own?.department) - Number(a.name === own?.department));
    const sites = own?.site === snapshot.offsite ? [snapshot.offsite,snapshot.home] : [snapshot.home,snapshot.offsite];
    for (const site of sites) {
      if (site === snapshot.offsite && !groups.some((group) => group.offsite.length)) continue;
      for (const group of groups) {
        if (site === snapshot.offsite) {
          if (group.offsite.length) {
            lines.push("", `**${clean(site)} · ${clean(group.name)}**`);
            for (const p of group.offsite) lines.push(`${clean(group.offsiteRole)}：${clean(p.name)}（${clean(p.slot)}）`);
          }
        } else {
          const homePower = (kind) => day.power[kind].filter((name) => day.people?.some((p) => p.name === name && p.department === group.name && p.site === snapshot.home));
          const whitePower = homePower("white"), nightPower = homePower("night");
          const primary = (list,power) => list.map((name) => `${clean(name)}${power.includes(name) ? "（兼动力）" : ""}`).join("、");
          lines.push("", `**${clean(site)} · ${clean(group.name)}**`, `白班主值：${primary(group.white,whitePower)}`, `白班辅值：${group.auxiliary === null ? "无（周末/节假日）" : names(group.auxiliary)}`, `夜班主值：${primary(group.night,nightPower)}`);
          const otherWhite = whitePower.filter((name) => !group.white.includes(name));
          const otherNight = nightPower.filter((name) => !group.night.includes(name));
          if (otherWhite.length) peopleLines("动力白班",otherWhite);
          if (otherNight.length) peopleLines("动力夜班",otherNight);
          if (group.standby.length) peopleLines("待命",group.standby);
        }
      }
    }
    const unknownPower = (kind) => day.power[kind].filter((name) => !day.people?.some((p) => p.name === name && p.site));
    const whiteUnknown = unknownPower("white"), nightUnknown = unknownPower("night");
    if (whiteUnknown.length || nightUnknown.length) {
      lines.push("", "**动力 · 地点待核对**");
      if (whiteUnknown.length) peopleLines("动力白班",whiteUnknown);
      if (nightUnknown.length) peopleLines("动力夜班",nightUnknown);
    }
    day.warnings.forEach((warning) => lines.push(`⚠ ${clean(warning)}`));
  });
  lines.push("", "白班08:30–17:30；夜班17:30–次日08:30", "白班辅值09:00–15:00；08:30前属前夜班", `在线表读取：${new Date(snapshot.fetchedAt).toLocaleString("zh-CN", {timeZone:"Asia/Shanghai", hour12:false})}`);
  const text = lines.join("\n");
  if (Buffer.byteLength(text, "utf8") > 3900) throw new Error("排班通知过长，停止发送以免截断");
  return text;
}
