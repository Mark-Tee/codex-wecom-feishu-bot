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
  return {date:day.date,viewer,reasons:[...new Set(reasons)],restricted:reasons.length>0,uncertain:!reasons.length&&!person.shiftKind&&!person.leave&&!person.offsite,restReason:person.leave?(person.restReason || person.roles?.find(role=>/^(?:调休|休假|休息|年假|事假|病假)$/.test(role)) || "已排休假或休息"):""};
}

export function leaveCheckSummary(result) {
  return result.restricted ? `不能请假或调休（${result.reasons.join("、")}）`
    : result.uncertain ? "待核对，原表有警告或班次未明确，不能据此判断可请假"
      : result.restReason ? `${result.restReason}，不列为新的请假或调休候选日` : "未命中本条限制，不代表请假已批准";
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

export function leaveCandidateRange(value, at) {
  const today=shanghaiDate(at),current=today.toISOString().slice(0,7);
  let month=value;
  if(!month || month==="本月")month=current;
  else if(month==="下月")month=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()+1,1)).toISOString().slice(0,7);
  if(!/^20\d{2}-\d{2}$/.test(month))throw Error("月份格式应为YYYY-MM");
  const first=new Date(`${month}-01T00:00:00Z`);
  if(!Number.isFinite(first.getTime()) || first.toISOString().slice(0,7)!==month)throw Error("月份不存在");
  const start=!value || value==="本月" ? today : first;
  const end=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0));
  const dates=Array.from({length:(end-start)/86400000+1},(_,index)=>addDays(start,index).toISOString().slice(0,10).replaceAll("-",""));
  return {month,start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10),dates,includesPast:start<today};
}

export function classifyLeaveCandidate(day,viewer,offsiteSite) {
  const result=checkRosterLeave(day,viewer,offsiteSite),person=day.people.find(item=>item.name===viewer);
  if(result.uncertain)return {date:day.date,kind:"pending",reason:result.uncertaintyReason || "班次未明确"};
  if(result.restricted)return {date:day.date,kind:"restricted",reason:result.reasons.join("、")};
  if(person.leave)return {date:day.date,kind:"rest",reason:result.restReason};
  if(person.shiftKind!=="white")return {date:day.date,kind:"pending",reason:"未明确排白班，不能列为候选"};
  return {date:day.date,kind:"candidate",reason:"原排白班且未命中三项限制"};
}
