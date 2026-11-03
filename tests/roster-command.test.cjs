const test = require("node:test");
const assert = require("node:assert/strict");
const {normalizeRosterCommand,isMenuPrompt} = require("../lib/roster-command.cjs");
test("BOT residue before known roster commands stays on deterministic routing",()=>{
 for(const command of ["查看排班","绑定排班群","解绑排班群","排班推送状态","排班身份","排班身份 测试甲"]){
  assert.equal(normalizeRosterCommand(`BOT ${command}`),command);
  assert.equal(normalizeRosterCommand(`bot\u00a0${command}`),command);
  assert.equal(normalizeRosterCommand(command),command);
 }
});
test("mention-only residue and explicit help are static menu requests, tasks are not",()=>{
 for(const value of ["","   ","BOT"," bot ","/help","帮助"])assert.equal(isMenuPrompt(value),true);
 for(const value of ["查看排班","BOT /pending","创建工单"])assert.equal(isMenuPrompt(value),false);
 assert.equal(normalizeRosterCommand("BOT /help"),"/help");
});
test("ordinary text and discussion of roster commands are not reinterpreted",()=>{
 for(const text of ["BOT 今天要做什么","请解释 BOT 查看排班 的实现","BOT 查看排班并删除文件","其他BOT 查看排班"])
  assert.equal(normalizeRosterCommand(text),text);
});

test("natural leave planning questions map to month queries without a model",()=>{
 for(const text of ["我哪几天可以用来请假调休","我这个月哪几天能调休？","BOT 我哪几天可以请假"]){assert.equal(normalizeRosterCommand(text),"请假候选 本月");}
 assert.equal(normalizeRosterCommand("我下个月哪几天可以请假"),"请假候选 下月");
 assert.equal(normalizeRosterCommand("BOT 调休候选 2026-11"),"调休候选 2026-11");
 assert.equal(normalizeRosterCommand("请解释我哪几天可以调休的代码"),"请解释我哪几天可以调休的代码");
});
