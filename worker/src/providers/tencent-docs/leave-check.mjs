import {readScheduleBroadcast} from "./schedule-broadcast.mjs";
import {checkRosterLeave,leaveCheckDate,leaveCheckSummary} from "../../core/leave-policy.mjs";

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
