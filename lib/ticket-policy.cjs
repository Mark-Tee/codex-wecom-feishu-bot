const {remoteDenial}=require("./remote-policy.cjs");
const TICKET_HELP = [
  "【工单机器人】", "", "日常查询与设置", "/as 姓名　设置本会话使用人", "例：/as 测试甲（换为本人）", "/pending　查看当前会话本人待办", "私聊：首页 / 我的工单 / 还有哪些没处理", "私聊与群聊任务独立；身份沿用需确认", "继续　查看本人待补充信息或待办", "补充 内容　回答待确认问题", "例：补充 进入时间为09:00", "首次使用先发送 /as 本人姓名", "/status　查看运行状态", "/help　查看本菜单", "",
  "工单处理 · 真实写入待实单验收", "发送清晰工单图片：识别并建飞书单", "/fill 短号　重试填写、核对并提交", "例：/fill 12（已提交的不重复提交）", "/done 短号　确认已提交，更新腾讯草稿", "例：/done 12（仅本会话任务）", "",
  "业务查重：双号齐全按组合", "只有一个单号时按该号查重", "并发或结果不明时先核验，勿盲目重试", "", "共享表测试保护开启时", "须本机单次许可；结果不明勿重复提交", "测试保护期间暂不写腾讯草稿", "", "动力值班：仅建飞书单", "指派人员、陪同人留空，无需 /done", "",
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
  if (["继续", "继续处理", "是", "是的", "不是", "直接记录", "按计划预录", "按当前进展", "已完成", "待办"].includes(prompt)) return "worker";
  if (/^补充\s+\S/.test(prompt)) return "worker";
  if (["首页", "我的工单", "还有哪些没处理"].includes(prompt)) return "worker";
  if (hasImages) return "worker";
  return "help";
}
module.exports = {ticketRoute,normalizeTicketCommand,TICKET_HELP};
