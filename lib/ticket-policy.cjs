const {remoteDenial}=require("./remote-policy.cjs");
const TICKET_HELP = [
  "【工单机器人】", "", "日常查询与设置", "/as 姓名　设置本会话使用人", "例：/as 测试甲（换为本人）", "/pending　查看本会话待办", "/status　查看运行状态", "/help　查看本菜单", "",
  "工单处理 · 真实写入待实单验收", "发送清晰工单图片：识别并建飞书单", "/fill 短号　重试填写、核对并提交", "例：/fill 12（已提交的不重复提交）", "/done 短号　确认已提交，更新腾讯草稿", "例：/done 12（仅本会话任务）", "",
  "动力值班：仅建飞书单", "指派人员、陪同人留空，无需 /done", "",
  "业务操作需授权；使用人须匹配成员。", "禁止修改排班源表或执行管理操作。", "排班查询请@排班机器人。", "只@我也可查看菜单。",
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
  if (hasImages) return "worker";
  return "help";
}
module.exports = {ticketRoute,normalizeTicketCommand,TICKET_HELP};
