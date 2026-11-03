import {addDays, dateKey, shanghaiDate} from "./duty-date.mjs";
import {orderIdentifiers, sameBusinessOrder} from "./order-identity.mjs";

const clean = value => String(value ?? "").replace(/[\r\n<>`*_\[\]]/g, " ").trim();
export function powerHandoffSlot(at) {
  const clock = new Intl.DateTimeFormat("en-GB", {timeZone:"Asia/Shanghai", hour:"2-digit", minute:"2-digit", hourCycle:"h23"}).format(at);
  const date = shanghaiDate(at);
  // Five-minute delivery window: no obsolete handoff drafts after sleep/restart.
  const kind = clock >= "16:30" && clock < "16:35" ? "white" : clock >= "07:30" && clock < "07:35" ? "night" : "";
  if (!kind) return null;
  const shiftDate = dateKey(kind === "white" ? date : addDays(date, -1));
  return {kind, key:`${shiftDate}:${kind}`, shiftDate, handoverDate:dateKey(date), prefix:`${kind === "white" ? "WD" : "WN"}${shiftDate}`,
    offsets:kind === "white" ? [0] : [-1, 0], time:kind === "white" ? "16:30" : "07:30", handoverTime:kind === "white" ? "17点30分" : "8点30分"};
}

export function powerHandoffPeople(slot, snapshot) {
  const outgoing = snapshot.days.find(day => day.date === slot.shiftDate);
  const incoming = snapshot.days.find(day => day.date === slot.handoverDate);
  if (!outgoing || !incoming || snapshot.days.some(day => day.warnings?.length)) throw Error("交班相关排班缺失或有待核对警告");
  const nextKind = slot.kind === "white" ? "night" : "white";
  const owner = outgoing.power[slot.kind], nextPower = incoming.power[nextKind];
  if (owner?.length !== 1 || nextPower?.length !== 1) throw Error("动力交接人员必须唯一");
  const explicitShift = incoming.people?.some(person=>Object.hasOwn(person,"shiftKind"));
  if(explicitShift && !incoming.people.every(person=>Object.hasOwn(person,"shiftKind")&&Object.hasOwn(person,"offsite")))throw Error("交班人员班次字段不完整");
  const onSite = explicitShift ? incoming.people.filter(person=>person.shiftKind===nextKind&&!person.offsite&&!person.leave).map(person=>person.name)
    : incoming.groups.flatMap(group => nextKind === "night" ? group.night : [...group.white, ...(group.auxiliary || []), ...group.standby]);
  const ordered = incoming.people?.map(person=>person.name) || onSite;
  return {owner:owner[0], nextPower:nextPower[0], onSite:[...new Set(ordered)].filter(name => onSite.includes(name) && name !== nextPower[0]), nextKind};
}

export function formatPowerHandoff({slot, people, records, settings, generatedAt}) {
  if (!settings.locationValue || !Array.isArray(settings.categoryRules) || !settings.categoryRules.length) throw Error("动力交班缺少地点或分类映射");
  const rules = settings.categoryRules.map(rule => ({...rule, regex:rule.descriptionPattern ? new RegExp(rule.descriptionPattern) : null}));
  const counts = new Map(), unique = [], uncertain = [];
  let total = 0, duplicates = 0, excludedTests = 0;
  const identified = records.map(record => ({record, identity:orderIdentifiers(record)}))
    .sort((a,b) => (Number(Boolean(b.identity.transactionNo))+Number(Boolean(b.identity.roomTicketNo))) - (Number(Boolean(a.identity.transactionNo))+Number(Boolean(a.identity.roomTicketNo))));
  for (const {record, identity} of identified) {
    if (record.location !== settings.locationValue || !record.number?.startsWith(slot.prefix) || !/^\d{3,}$/.test(record.number.slice(slot.prefix.length))) continue;
    if (record.description.includes("【测试勿统计】")) {excludedTests++; continue;}
    const matched = rules.filter(rule => rule.workContentValue === record.workContent && (!rule.regex || rule.regex.test(record.description)));
    const category = matched.length === 1 && matched[0].category ? clean(matched[0].category) : "待核对分类";
    const previous = (identity.transactionNo || identity.roomTicketNo) ? unique.filter(item => sameBusinessOrder(item.identity,identity)) : [];
    if (previous.length) {
      duplicates++;
      for (const item of previous) if (item.category !== category) {item.category="待核对分类";item.numbers.push(record.number);}
      continue;
    }
    unique.push({identity,category,numbers:[record.number]});
  }
  for (const item of unique) {
    if (item.category === "待核对分类") uncertain.push(...item.numbers.map(clean));
    counts.set(item.category,(counts.get(item.category)||0)+1);total++;
  }
  const categories=Object.fromEntries([...new Set([...rules.map(rule=>clean(rule.category)),"待核对分类"])].filter(name=>counts.has(name)).map(name=>[name,counts.get(name)]));
  const date = slot.handoverDate;
  const generated = new Intl.DateTimeFormat("zh-CN", {timeZone:"Asia/Shanghai",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(generatedAt);
  const text = ["【动力交班模拟草稿】", `统计截至：${generated}；不代表实际已完成交接班。`, "",
    `${date.slice(4,6)}月${date.slice(6,8)}日，截至${slot.handoverTime}，合肥IDC动力值班已完成交接班。`,
    `${date}${people.nextKind === "white" ? "白班" : "夜班"}合肥IDC${clean(settings.siteName)}值班：${clean(people.nextPower)}  在岗：${people.onSite.map(clean).join("、") || "无其他排班人员"}`,
    `合肥IDC动力值班${slot.kind === "white" ? "白班" : "夜班"}共处理${total}个任务单。`,
    `（${Object.entries(categories).map(([name,count]) => `${name}${count}次`).join("，") || "截至生成时刻暂无登记任务"}）`, "",
    uncertain.length ? `待核对任务：${uncertain.join("、")}` : "",
    "交班前复核人员、任务及实际完成情况，再发群。",
  ].filter((line,index,all) => line || all[index-1] !== "").join("\n");
  return {text, total, categories, uncertain:[...new Set(uncertain)], duplicates, excludedTests};
}
