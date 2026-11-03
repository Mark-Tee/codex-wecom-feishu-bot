const {remoteDenial}=require("./remote-policy.cjs");
const TICKET_HELP = [
  "【工单机器人】", "",
  "人 姓名　设置本人，如：人 测试甲", "发图片　识别并建飞书单", "单　查看本人待办；继续　查看待确认", "补 内容　补充信息，如：补 09:00", "填12　重试短号12的填报", "完12　确认飞书已提交，生成腾讯草稿", "",
  "清10　停止追踪指定短号", "清全部　预览并确认清本人当前会话待办", "清除不删除飞书、腾讯在线记录；处理中暂不能清", "菜单　使用说明；状态　运行状态", "私聊可发：首页", "旧口令仍可用；仅本会话本人任务", "动力值班仅建飞书单，人员留空，无需“完”", "结果不明联系维护者，勿重复提交", "测试保护开启时须许可，不写腾讯草稿", "真实写入待实单验收；不自动改正式腾讯表", "操作需授权；排班请@排班机器人",
].join("\n");
function normalizeTicketCommand(value) {
  const text=String(value||"").trim(),candidate=text.replace(/^BOT\s+/iu,"");
  const aliases={"单":"/pending","菜单":"/help","状态":"/status","清全部":"/forget all","确认清全部":"/forget confirm"};
  if(Object.hasOwn(aliases,candidate))return aliases[candidate];
  const task=candidate.match(/^(填|完)\s*(\d{1,8})$/u);
  if(task)return `/${task[1]==="填"?"fill":"done"} ${task[2]}`;
  const forget=candidate.match(/^清\s*(\d{1,8})$/u);
  if(forget)return `/forget ${forget[1]}`;
  const person=candidate.match(/^人\s+(\S+)$/u);
  if(person)return `/as ${person[1]}`;
  const supplement=candidate.match(/^补\s+([\s\S]+)$/u);
  if(supplement)return `补充 ${supplement[1]}`;
  if(/^\/(?:draft|done|fill|pending|cancel|as|user|help|status|stop|pair|invite|paircode|operators|revoke)(?:\s|$)/i.test(candidate)
    || /^(?:我是|使用人|切换到)/.test(candidate)) return candidate;
  return text;
}
function ticketRoute(text, hasImages = false) {
  const prompt=normalizeTicketCommand(text);
  if(remoteDenial(prompt))return "denied";
  if (/^(?:查看排班|绑定排班群|解绑排班群|排班推送状态|排班身份|动力交班状态|请假候选|调休候选|请假检查|调休检查)(?:\s|$)/.test(prompt)) return "roster";
  if (/^(?:\/(?:help|status|stop|pair|invite|paircode|operators|revoke)(?:\s|$)|帮助$|状态$|运行状态$|健康$|停止$)/i.test(prompt)) return "local";
  if (/^\/(?:draft|done|fill|pending|cancel|as|user|forget)(?:\s|$)/i.test(prompt) || /^(?:我是|使用人|切换到)/.test(prompt) || /工单|周报|交接班/.test(prompt)) return "worker";
  if (["继续", "继续处理", "是", "是的", "不是", "直接记录", "按计划预录", "按当前进展", "已完成", "待办"].includes(prompt)) return "worker";
  if (/^补充\s+\S/.test(prompt)) return "worker";
  if (["首页", "我的工单", "还有哪些没处理"].includes(prompt)) return "worker";
  if (hasImages) return "worker";
  return "help";
}
function ticketBusyReply(prompt,busy) {
  return busy && /^\/forget(?:\s|$)/i.test(prompt) ? "机器人仍有任务处理中，本次未清除。结束后请重新发送清除指令；在线记录未改动。" : "";
}
module.exports = {ticketRoute,normalizeTicketCommand,TICKET_HELP,ticketBusyReply};
