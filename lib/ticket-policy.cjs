const {remoteDenial}=require("./remote-policy.cjs");
const TICKET_HELP = [
  "【工单机器人】", "",
  "/as 姓名　设置本人，如 /as 测试甲", "发送工单图片　识别并建飞书单", "补充 内容　回答待确认问题", "例：补充 进入时间为09:00", "继续 / /pending　本人待确认与待办", "/fill 短号　重试填报，如 /fill 12", "/done 短号　生成腾讯草稿，如 /done 12", "仅确认飞书已提交后发 /done", "",
  "私聊：首页 / 我的工单 / 还有哪些没处理", "/status　运行状态；/help　本菜单", "",
  "仅本会话本人任务；业务操作需授权", "动力值班仅建飞书单，人员留空，无需 /done", "结果不明请联系维护者，勿重复提交", "测试保护开启时须许可，不写腾讯草稿", "真实写入待实单验收；不自动改正式腾讯表", "排班查询请@排班机器人",
].join("\n");
function normalizeTicketCommand(value) {
  const text=String(value||"").trim(),candidate=text.replace(/^BOT\s+/iu,"");
  if(/^\/(?:draft|done|fill|pending|cancel|as|user|help|status|stop|pair|invite|paircode|operators|revoke)(?:\s|$)/i.test(candidate)
    || /^(?:我是|使用人|切换到)/.test(candidate)) return candidate;
  return text;
}
function ticketRoute(text, hasImages = false) {
  const prompt=normalizeTicketCommand(text);
  if(remoteDenial(prompt))return "denied";
  if (/^(?:查看排班|绑定排班群|解绑排班群|排班推送状态|排班身份)(?:\s|$)/.test(prompt)) return "roster";
  if (/^(?:\/(?:help|status|stop|pair|invite|paircode|operators|revoke)(?:\s|$)|帮助$|状态$|运行状态$|健康$|停止$)/i.test(prompt)) return "local";
  if (/^\/(?:draft|done|fill|pending|cancel|as|user)(?:\s|$)/i.test(prompt) || /^(?:我是|使用人|切换到)/.test(prompt) || /工单|周报|交接班/.test(prompt)) return "worker";
  if (["继续", "继续处理", "是", "是的", "不是", "直接记录", "按计划预录", "按当前进展", "已完成", "待办"].includes(prompt)) return "worker";
  if (/^补充\s+\S/.test(prompt)) return "worker";
  if (["首页", "我的工单", "还有哪些没处理"].includes(prompt)) return "worker";
  if (hasImages) return "worker";
  return "help";
}
module.exports = {ticketRoute,normalizeTicketCommand,TICKET_HELP};
