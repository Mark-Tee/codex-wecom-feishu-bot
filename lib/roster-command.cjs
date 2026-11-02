const SIMPLE_COMMANDS = new Set(["绑定排班群", "解绑排班群", "排班推送状态", "查看排班"]);

function normalizeRosterCommand(value) {
  const text = String(value || "").trim();
  // A multi-word mention such as @Assistant BOT leaves BOT after the generic
  // mention token is removed. Strip that residue only before known roster commands.
  const candidate = text.replace(/^BOT\s+/iu, "");
  return SIMPLE_COMMANDS.has(candidate) || /^排班身份(?:\s|$)/u.test(candidate) ? candidate : text;
}
module.exports = {normalizeRosterCommand};
