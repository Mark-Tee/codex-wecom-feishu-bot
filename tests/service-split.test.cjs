const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {readServiceProfile}=require("../lib/service-profile.cjs");
const {ticketRoute,normalizeTicketCommand}=require("../lib/ticket-policy.cjs");
const {createRosterService}=require("../lib/roster-service.cjs");

test("service profiles separate roles ports and entry points, reject invalid configuration",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"bot-profile-test-"));
 try{
  const write=(service)=>fs.writeFileSync(path.join(root,"config.json"),JSON.stringify({service}));
  write({role:"roster",healthPort:8799,guardianPort:8798,taskName:"RosterBot"});assert.equal(readServiceProfile(root).entry,"roster-bot.cjs");
  write({role:"ticket",healthPort:8809,guardianPort:8808,taskName:"TicketBot"});assert.equal(readServiceProfile(root).healthPort,8809);assert.equal(readServiceProfile(root).entry,"bridge.cjs");
  const alternate=path.join(root,"alternate.json");fs.writeFileSync(alternate,JSON.stringify({service:{role:"roster"}}));assert.equal(readServiceProfile(root,alternate).role,"roster");
  for(const input of [{role:"unknown"},{role:""},{healthPort:0},{healthPort:8798,guardianPort:8798},{taskName:"bad/task"},{taskName:""}]){write(input);assert.throws(()=>readServiceProfile(root));}
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test("ticket role keeps roster and unrelated tasks out of model and worker routes",()=>{
 for(const text of ["查看排班","排班身份 测试甲"])assert.equal(ticketRoute(text),"roster");
 for(const text of ["帮我做一个网站","/usage"])assert.equal(ticketRoute(text),"help");
 for(const text of ["/as 测试甲","我是测试甲","/pending","/done 12","/fill 12","/draft","请处理工单"])assert.equal(ticketRoute(text),"worker");
 assert.equal(ticketRoute("/help"),"local");assert.equal(ticketRoute("/help",true),"local");assert.equal(ticketRoute("查看排班",true),"roster");assert.equal(ticketRoute("",true),"worker");
 assert.equal(normalizeTicketCommand("BOT /as 测试甲"),"/as 测试甲");assert.equal(ticketRoute("BOT /pending"),"worker");assert.equal(ticketRoute("BOT /help"),"local");assert.equal(normalizeTicketCommand("BOT 普通聊天"),"BOT 普通聊天");
});
test("roster service refuses unauthorized senders and never dispatches unrelated text or images",async()=>{
 const state={__operators:["owner"]},replies=[];let dispatched=0,saves=0;
 const handle=createRosterService({state,save:()=>saves++,controller:{command:async(_,text)=>{if(text==="查看排班"){dispatched++;return true;}return false;}},reply:async(_,text)=>replies.push(text),health:()=>({authenticated:true}),makeCode:()=>"123456"});
 const frame=(id,userId,text,msgtype="text")=>({cmd:"aibot_msg_callback",body:{msgid:id,msgtype,chattype:"group",chatid:"test-group",from:{userid:userId},text:{content:text}}});
 await handle(frame("a","stranger","查看排班"));assert.equal(dispatched,0);assert.match(replies.at(-1),/无权限/);
 await handle(frame("menu","stranger","@Assistant BOT"));assert.match(replies.at(-1),/【排班机器人】/);assert.equal(dispatched,0);
 await handle(frame("menu-empty","owner","@排班机器人"));assert.match(replies.at(-1),/只@我/);assert.equal(dispatched,0);
 await handle(frame("b","owner","@Assistant BOT 查看排班"));assert.equal(dispatched,1);await handle(frame("b","owner","查看排班"));assert.equal(dispatched,1);
 await handle(frame("c","owner","创建飞书工单"));assert.match(replies.at(-1),/只读查询/);
 await handle(frame("d","owner","","image"));assert.match(replies.at(-1),/不识别工单图片/);assert.equal(dispatched,1);
 for(const command of ["/invite","/pair 123456","绑定排班群","解绑排班群","请把排班表改成测试甲"]) {
  await handle(frame(command,"owner",command));assert.match(replies.at(-1),/无权限/);
 }
 assert.equal(state.__pairing,undefined);assert.deepEqual(state.__operators,["owner"]);assert.equal(dispatched,1);assert.ok(saves>0);
});
