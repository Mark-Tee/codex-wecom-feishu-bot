const SIMPLE_COMMANDS = new Set(["绑定排班群", "解绑排班群", "排班推送状态", "动力交班状态", "查看排班", "我的排班", "我今天什么班", "我明天什么班", "我的排班身份", "/help", "帮助"]);

function normalizeRosterCommand(value) {
  const text = String(value || "").trim();
  // A multi-word mention such as @Assistant BOT leaves BOT after the generic
  // mention token is removed. Strip that residue only before known roster commands.
  const candidate = text.replace(/^BOT\s+/iu, "");
  const planning=candidate.match(/^我(这个月|本月|下个月|下月)?哪几天(?:可以|能)(?:用来)?(?:请假(?:[、或和/]?调休)?|调休)[？?]?$/u);
  if(planning)return `请假候选 ${["下个月","下月"].includes(planning[1])?"下月":"本月"}`;
  return SIMPLE_COMMANDS.has(candidate) || /^(?:(?:排班身份|请假检查|调休检查|请假候选|调休候选)(?:\s|$)|我是)/u.test(candidate) ? candidate : text;
}
function isMenuPrompt(value) {
  const text=String(value||"").trim();
  return !text || /^BOT$/iu.test(text) || text==="/help" || text==="帮助";
}
module.exports = {normalizeRosterCommand,isMenuPrompt};
