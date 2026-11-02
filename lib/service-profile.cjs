const fs = require("node:fs");
const path = require("node:path");
function readServiceProfile(root, configPath = path.join(root,"config.json")) {
  const config = JSON.parse(fs.readFileSync(configPath,"utf8").replace(/^\uFEFF/,""));
  const input = config.service || {};
  const role = input.role ?? "combined";
  if (!["combined","roster","ticket"].includes(role)) throw new Error("Invalid service role");
  const healthPort = Number(input.healthPort ?? 8799), guardianPort = Number(input.guardianPort ?? 8798);
  if (![healthPort,guardianPort].every(n=>Number.isInteger(n)&&n>=1024&&n<=65535)||healthPort===guardianPort) throw new Error("Invalid service ports");
  const taskName = input.taskName ?? "CodexWeComBridge";
  if(!/^[A-Za-z0-9_-]{1,64}$/.test(taskName)) throw new Error("Invalid service task name");
  return Object.freeze({role,healthPort,guardianPort,taskName,entry:role==="roster"?"roster-bot.cjs":"bridge.cjs"});
}
module.exports = {readServiceProfile};
