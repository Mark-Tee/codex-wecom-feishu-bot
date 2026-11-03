import {shanghaiDate,addDays} from "./duty-date.mjs";

export function checkRosterLeave(day, viewer, offsiteSite) {
  const person=day.people?.find(item=>item.name===viewer);
  if(!person)throw Error("排班中找不到本人身份，不能判断请假或调休");
  if(day.warnings?.length)return {date:day.date,viewer,reasons:[],restricted:false,uncertain:true,uncertaintyReason:day.warnings.join("；")};
  const reasons=[];
  if(day.power?.night?.includes(viewer))reasons.push("动力夜班");
  else if(person.shiftKind==="night" || day.groups?.some(group=>group.night?.includes(viewer)))reasons.push("夜班");
  for(const group of day.groups || []) {
    if(group.white?.includes(viewer))reasons.push(`${group.name}白班主值`);
    if(group.offsite?.some(item=>item.name===viewer && item.slot==="网络1"))reasons.push(`${offsiteSite || "异地"}网络1`);
  }
  return {date:day.date,viewer,reasons:[...new Set(reasons)],restricted:reasons.length>0,uncertain:!reasons.length&&!person.shiftKind&&!person.leave&&!person.offsite};
}

export function leaveCheckSummary(result) {
  return result.restricted ? `不能请假或调休（${result.reasons.join("、")}）`
    : result.uncertain ? "待核对，原表有警告或班次未明确，不能据此判断可请假"
      : "未命中本条限制，不代表请假已批准";
}

export function leaveCheckDate(value, at) {
  const today=shanghaiDate(at),parts=today.toISOString().slice(0,10);
  if(!value || value==="今天")return {date:parts,offset:0};
  if(value==="明天")return {date:addDays(today,1).toISOString().slice(0,10),offset:1};
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(value))throw Error("日期格式应为YYYY-MM-DD");
  const date=new Date(`${value}T00:00:00Z`);
  if(!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==value)throw Error("日期不存在");
  return {date:value,offset:(date.getTime()-today.getTime())/86400000};
}
