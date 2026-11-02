const TICKET_HELP = [
  "【工单机器人】",
  "只@我不附文字，或发送/help，均显示本菜单。菜单不调用模型，业务操作仍需授权。",
  "只处理工单，排班查询请@排班机器人。",
  "工单图片 / /draft：识别并创建飞书工单。",
  "/as 姓名：设置工单使用人，例如 /as 测试甲（换为本人）。",
  "/pending：本会话待办；/fill 短号：重试填写。",
  "/done 短号：已提交后更新腾讯草稿；/cancel 短号：取消本地待办。",
  "例：/fill 12、/done 12。动力值班仅建飞书单，两个人员字段留空，无需/done。",
  "/status：运行状态；/stop：停止当前任务；/help：本说明。",
  "/invite、/pair 配对码、/operators、/revoke 用户ID：操作者授权。",
  "按原有规则处理周报与交接；不执行普通聊天指示或本机任意命令。",
].join("\n");
function normalizeTicketCommand(value) {
  const text=String(value||"").trim(),candidate=text.replace(/^BOT\s+/iu,"");
  if(/^\/(?:draft|done|fill|pending|cancel|as|user|help|status|stop|pair|invite|paircode|operators|revoke)(?:\s|$)/i.test(candidate)
    || /^(?:我是|使用人|切换到)/.test(candidate)) return candidate;
  return text;
}
function ticketRoute(text, hasImages = false) {
  const prompt=normalizeTicketCommand(text);
  if (/^(?:查看排班|绑定排班群|解绑排班群|排班推送状态|排班身份)(?:\s|$)/.test(prompt)) return "roster";
  if (/^(?:\/(?:help|status|stop|pair|invite|paircode|operators|revoke)(?:\s|$)|帮助$|状态$|运行状态$|健康$|停止$)/i.test(prompt)) return "local";
  if (/^\/(?:draft|done|fill|pending|cancel|as|user)(?:\s|$)/i.test(prompt) || /^(?:我是|使用人|切换到)/.test(prompt) || /工单|周报|交接班/.test(prompt)) return "worker";
  if (hasImages) return "worker";
  return "help";
}
module.exports = {ticketRoute,normalizeTicketCommand,TICKET_HELP};
