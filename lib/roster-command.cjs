const SIMPLE_COMMANDS = new Set(["绑定排班群", "解绑排班群", "排班推送状态", "动力交班状态", "查看排班", "我的排班", "我今天什么班", "我明天什么班", "我的排班身份", "/help", "帮助"]);

function normalizeRosterCommand(value) {
  const text = String(value || "").trim();
  // A multi-word mention such as @Assistant BOT leaves BOT after the generic
  // mention token is removed. Strip that residue only before known roster commands.
  const candidate = text.replace(/^BOT\s+/iu, "");
  const aliases={"班":"查看排班","今":"查看排班 0","明":"查看排班 1","我":"排班身份","推送":"排班推送状态","交班":"动力交班状态","菜单":"/help","状态":"/status"};
  if(Object.hasOwn(aliases,candidate))return aliases[candidate];
  const person=candidate.match(/^我\s+(\S+)$/u);
  if(person)return `排班身份 ${person[1]}`;
  const leave=candidate.match(/^休\s*(今|今天|明|明天|20\d{2}-\d{2}-\d{2})$/u);
  if(leave)return `请假检查 ${{"今":"今天","明":"明天"}[leave[1]] || leave[1]}`;
  const month=candidate.match(/^休(?:\s*(本月|下月|20\d{2}-\d{2}))?$/u);
  if(month)return `请假候选 ${month[1] || "本月"}`;
  const planning=candidate.match(/^我(这个月|本月|下个月|下月)?哪几天(?:可以|能)(?:用来)?(?:请假(?:[、或和/]?调休)?|调休)[？?]?$/u);
  if(planning)return `请假候选 ${["下个月","下月"].includes(planning[1])?"下月":"本月"}`;
  return SIMPLE_COMMANDS.has(candidate) || /^(?:(?:排班身份|请假检查|调休检查|请假候选|调休候选)(?:\s|$)|我是)/u.test(candidate) ? candidate : text;
}
function isMenuPrompt(value) {
  const text=String(value||"").trim();
  return !text || /^BOT$/iu.test(text) || text==="/help" || text==="帮助";
}
module.exports = {normalizeRosterCommand,isMenuPrompt};
