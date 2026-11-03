import {readScheduleBroadcast,readScheduleSheet,summarizeSchedule} from "./schedule-broadcast.mjs";
import {sheetForDate} from "../../core/duty-date.mjs";
import {checkRosterLeave,leaveCheckDate,leaveCheckSummary,leaveCandidateRange,classifyLeaveCandidate} from "../../core/leave-policy.mjs";

export async function readLeaveCheck({client,config,at,viewer,date}) {
  if(!viewer)throw Error("请先绑定本人排班身份");
  const selected=leaveCheckDate(date,at);
  const snapshot=await readScheduleBroadcast({client,config,at,offsets:[selected.offset]});
  const result=checkRosterLeave(snapshot.days[0],viewer,snapshot.offsite);
  return ["【请假／调休规则检查】",`姓名：${viewer}`,`排班日期：${selected.date}`,`结果：${leaveCheckSummary(result)}`,...(result.uncertaintyReason?[`待核对原因：${result.uncertaintyReason}`]:[]),"",
    `规则：夜班（含动力夜班）、系统或网络白班主值、${snapshot.offsite}网络1，任一命中即受限。`,
    "日期按排班表当天行，夜班归开班日。只检查岗位限制，不办理或批准请假，不改排班。",
    result.restricted ? "下一步：该日期命中限制，不要按可请假或调休安排；需调整时先联系排班负责人核对。"
      : result.uncertain ? "下一步：联系排班负责人核对当日班次；排班明确后重新检查。"
        : "下一步：如需请假或调休，另行办理；本结果不代表已获批准。",
    `在线排班读取：${new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",dateStyle:"short",timeStyle:"short"}).format(new Date(snapshot.fetchedAt))}`,
  ].join("\n");
}

export async function readLeaveCandidates({client,config,at,viewer,month}) {
  if(!viewer)throw Error("请先绑定本人排班身份");
  const range=leaveCandidateRange(month,at);
  if(config.sources?.mode!=="online")throw Error("请假候选需要在线排班表");
  const source=config.sources.online.schedule,info=await client.getSheetInfo(source);
  const sheetName=sheetForDate(new Date(`${range.month}-01T00:00:00Z`),config.schedule.sheet_format);
  const sheet=info.sheets.find(item=>item.sheet_name===sheetName);
  if(!sheet)throw Error("该月排班表尚未找到，请确认月份已发布");
  const data=await readScheduleSheet({client,config,source,sheet,dates:range.dates});
  const entries=range.dates.map(date=>{
    try{return classifyLeaveCandidate(summarizeSchedule({...data,date,config}),viewer,config.site_rules.offsite_site);}
    catch(error){const message=String(error.message || "");return {date,kind:"pending",reason:/日期缺失或重复/.test(message)?"该日期未排班或有重复行":/排班|岗位|主值|动力|人员|辅值|异地|部门|休假/.test(message)?message:"当日排班未能完整核验"};}
  });
  const counts=Object.fromEntries(["candidate","rest","restricted","pending"].map(kind=>[kind,entries.filter(item=>item.kind===kind).length]));
  const lines=["【请假／调休候选日】",`姓名：${viewer}`,`范围：${range.start}—${range.end}`,"只列原排白班且未命中三项限制的日期，不代表已批准。",""];
  const dateLines=list=>{
    for(let index=0;index<list.length;index+=3)lines.push(list.slice(index,index+3).map(item=>`${item.date.slice(4,6)}/${item.date.slice(6,8)}（${"日一二三四五六"[new Date(`${item.date.slice(0,4)}-${item.date.slice(4,6)}-${item.date.slice(6,8)}T00:00:00Z`).getUTCDay()]}）`).join("、"));
  };
  for(const [kind,title] of [["candidate","可考虑的工作日"],["rest","原本已休，不算新候选"],["restricted","命中限制"],["pending","待核对，不列候选"]]){
    const selected=entries.filter(item=>item.kind===kind);lines.push(`${title}：${selected.length}天`);
    if(!selected.length)lines.push("无");
    else if(kind==="candidate")dateLines(selected);
    else for(const reason of new Set(selected.map(item=>item.reason))){lines.push(reason);dateLines(selected.filter(item=>item.reason===reason));}
    lines.push("");
  }
  if(range.includesPast)lines.push("范围包含已过日期，过去日期仅作排班回看。");
  lines.push("下一步：选定日期后发“请假检查 YYYY-MM-DD”复查最新排班，再另行办理；机器人不批准或办理请假。",`在线排班读取：${new Intl.DateTimeFormat("zh-CN",{timeZone:"Asia/Shanghai",dateStyle:"short",timeStyle:"short"}).format(new Date())}`);
  return {text:lines.join("\n"),range,entries,counts};
}
