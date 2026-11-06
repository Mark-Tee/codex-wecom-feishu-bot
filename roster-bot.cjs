#!/usr/bin/env node
// Read-only roster and handoff entry point. No model, form filling or ticket worker.
const fs=require("node:fs"),path=require("node:path"),http=require("node:http"),crypto=require("node:crypto");
const {pathToFileURL}=require("node:url");
const {readServiceProfile}=require("./lib/service-profile.cjs");
const {appendRotatingLog}=require("./lib/rotating-log.cjs");
const {WeComLongConnection}=require("./lib/wecom-long-connection.cjs");
const {createScheduleBroadcast}=require("./lib/schedule-broadcast.cjs");
const {createRosterService,ROSTER_HELP}=require("./lib/roster-service.cjs");
const {createInteractionCards}=require("./lib/interaction-cards.cjs");
const {createPowerHandoff}=require("./lib/power-handoff.cjs");
const {parseInbound,createIngressGuard}=require("./lib/input-guard.cjs");
const {localRequest}=require("./lib/local-http.cjs");
const {createAccessRequests}=require("./lib/access-request.cjs");
const ROOT=__dirname,profile=readServiceProfile(ROOT);
const {createObservability}=require("./lib/observability.cjs");
const observability=createObservability({root:ROOT,role:"roster"});
observability.flush();
if(profile.role!=="roster")throw Error("Roster entry requires service.role=roster");
const config=JSON.parse(fs.readFileSync(path.join(ROOT,"config.json"),"utf8").replace(/^\uFEFF/,""));
const allowUsers=Array.isArray(config.allowUsers)?config.allowUsers:[];
if(!config.botId||!config.secret||!config.roster?.rulesRoot||!config.roster?.businessConfigPath)throw Error("Roster configuration incomplete");
const rulesRoot=path.resolve(ROOT,config.roster.rulesRoot),businessConfigPath=path.resolve(ROOT,config.roster.businessConfigPath);
const file=path.join(ROOT,"roster-state.json");
const state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,"")):{};
function syncPairing(value) {
  const pairingFile=path.join(ROOT,"pairing-code.txt");
  if(value.__pairing?.expiresAt>Date.now() && !allowUsers.length) {
    fs.writeFileSync(pairingFile,`排班配对码：${value.__pairing.code}\n有效期：${new Date(value.__pairing.expiresAt).toISOString()}\n`,{mode:0o600});
  } else if(fs.existsSync(pairingFile)) fs.rmSync(pairingFile);
}
function save(value){const temp=file+".tmp";fs.writeFileSync(temp,JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(temp,file);syncPairing(value);}
function log(...values){observability.system(values);const text=values.map(String).join(" ").replaceAll(config.botId,"[robot]").replaceAll(config.secret,"[credential]");try{appendRotatingLog(path.join(ROOT,"logs","roster.log"),`[${new Date().toISOString()}] ${text}\n`);}catch{}}
let WS;try{WS=require("ws");}catch{try{WS=require(path.join(ROOT,"vendor","ws"));}catch{WS=globalThis.WebSocket;}}
let handle,cards;
const connection=new WeComLongConnection({WebSocketImpl:WS,url:"wss://openws.work.weixin.qq.com",botId:config.botId,secret:config.secret,log,parseFrame:parseInbound,onFrame:frame=>handle(frame).catch(()=>log("排班消息处理失败，请重试"))});
const rawReply=(frame,text)=>frame.__cardAction?connection.send("aibot_send_msg",{chatid:frame.body.chattype==="group"?frame.body.chatid:frame.body.from.userid,chat_type:frame.body.chattype==="group"?2:1,msgtype:"markdown",markdown:{content:text}}):connection.send("aibot_respond_msg",{msgtype:"stream",stream:{id:connection.requestId("roster"),finish:true,content:text}},frame.headers?.req_id);
const reply=(frame,text)=>cards&&text===ROSTER_HELP&&!frame.__plainHelp?cards.menu(frame):rawReply(frame,text);
const business=()=>{const source=JSON.parse(fs.readFileSync(businessConfigPath,"utf8").replace(/^\uFEFF/,""));return {sources:{mode:source.sources.mode,online:{schedule:source.sources.online.schedule}},schedule:source.schedule,site_rules:source.site_rules};};
const load=(relative)=>import(pathToFileURL(path.join(rulesRoot,relative)).href);
const controller=createScheduleBroadcast({state,save,reply,send:(chatid,chatType,text)=>connection.send("aibot_send_msg",{chatid,chat_type:chatType,msgtype:"markdown",markdown:{content:text}}),ready:()=>connection.authenticated,log,members:async()=>business().site_rules.departments.flatMap(group=>group.members),read:async(at,selection={})=>{
  const {TencentDocsClient}=await load("src/providers/tencent-docs/client.mjs");
  const {readScheduleBroadcast,formatScheduleBroadcast}=await load("src/providers/tencent-docs/schedule-broadcast.mjs");
  const client=new TencentDocsClient();
  const readOnly=Object.freeze({getSheetInfo:client.getSheetInfo.bind(client),getCsv:client.getCsv.bind(client),getStyles:client.getStyles.bind(client)});
  return formatScheduleBroadcast(await readScheduleBroadcast({client:readOnly,config:business(),at,...selection}),{viewer:selection.viewer||""});
},readLeave:async(at,selection)=>{
  const {TencentDocsClient}=await load("src/providers/tencent-docs/client.mjs");
  const {readLeaveCheck}=await load("src/providers/tencent-docs/leave-check.mjs");
  const client=new TencentDocsClient();
  return readLeaveCheck({client:Object.freeze({getSheetInfo:client.getSheetInfo.bind(client),getCsv:client.getCsv.bind(client),getStyles:client.getStyles.bind(client)}),config:business(),at,...selection});
},readCandidates:async(at,selection)=>{
  const {TencentDocsClient}=await load("src/providers/tencent-docs/client.mjs");
  const {readLeaveCandidates}=await load("src/providers/tencent-docs/leave-check.mjs");
  const client=new TencentDocsClient();
  return (await readLeaveCandidates({client:Object.freeze({getSheetInfo:client.getSheetInfo.bind(client),getCsv:client.getCsv.bind(client),getStyles:client.getStyles.bind(client)}),config:business(),at,...selection})).text;
}});
const handoffSettings=config.roster.powerHandoff;
async function handoffSchedule(at) {
  const {powerHandoffSlot,powerHandoffPeople}=await load("src/core/power-handoff.mjs");
  const {readScheduleBroadcast}=await load("src/providers/tencent-docs/schedule-broadcast.mjs");
  const {TencentDocsClient}=await load("src/providers/tencent-docs/client.mjs");
  const slot=powerHandoffSlot(at);if(!slot)throw Error("不在动力交班提醒窗口");
  const client=new TencentDocsClient();
  const snapshot=await readScheduleBroadcast({client:Object.freeze({getSheetInfo:client.getSheetInfo.bind(client),getCsv:client.getCsv.bind(client),getStyles:client.getStyles.bind(client)}),config:business(),at,offsets:slot.offsets});
  const people=powerHandoffPeople(slot,snapshot);
  return {slot,people,owner:people.owner};
}
const handoff=handoffSettings?.enabled ? createPowerHandoff({state,save,schedule:handoffSchedule,enabledAt:handoffSettings.enabledAt,ready:()=>connection.authenticated,
  authorized:user=>allowUsers.length?allowUsers.includes(user):(state.__operators||[]).includes(user),log,
  send:(user,text)=>connection.send("aibot_send_msg",{chatid:user,chat_type:1,msgtype:"markdown",markdown:{content:text}}),
  draft:async(context)=>{
    const {loadConfig}=await load("src/config.mjs");
    const {readHandoffRecords}=await load("src/platforms/feishu-browser/handoff-reader.mjs");
    const {formatPowerHandoff}=await load("src/core/power-handoff.mjs");
    const workerConfig=loadConfig(path.resolve(ROOT,handoffSettings.workerConfigPath));
    const records=await readHandoffRecords(workerConfig.feishuBrowser,context.slot.prefix);
    const latest=await handoffSchedule(new Date());
    if(latest.slot.key!==context.slot.key||JSON.stringify(latest.people)!==JSON.stringify(context.people))throw Error("交班排班已变化，重新核验后再生成");
    return formatPowerHandoff({slot:context.slot,people:context.people,records,settings:{...handoffSettings,siteName:business().site_rules.home_site},generatedAt:new Date()}).text;
  },
}) : null;
const health=()=>({service:"codex-wecom-bridge",serviceId:crypto.createHash("sha256").update(ROOT).digest("hex"),role:"roster",pid:process.pid,authenticated:connection.authenticated,uptimeSeconds:Math.floor(process.uptime()),busy:ingress.status().running>0,observability:observability.status(),connectionStale:Boolean(connection.healthWatch&&Date.now()-connection.healthWatch.snapshot().lastReceivedAt>300_000)});
const rosterHandle=createRosterService({state,save,controller,reply,health,handoff,allowUsers,observeStart:observability.start,observe:observability.mark,makeCode:()=>String(crypto.randomInt(100000,1000000))});
cards=createInteractionCards({role:"roster",state,save,send:connection.send.bind(connection),reply:rawReply,help:ROSTER_HELP,log,dispatch:frame=>observedRosterHandle(frame),authorized:user=>allowUsers.length?allowUsers.includes(user):(state.__operators||[]).includes(user)});
async function observedRosterHandle(frame){try{return await rosterHandle(frame);}catch(error){observability.mark(frame,"failed");throw error;}finally{observability.finish(frame);}}
const accessRequests=createAccessRequests({state,save,members:()=>business().site_rules.departments.flatMap(group=>group.members),reply:rawReply,role:"roster",allowUsers,secret:config.secret,port:profile.healthPort});
const ingress=createIngressGuard({authorized:accessRequests.authorized,allowRequest:accessRequests.allows});
handle=async frame=>{
  if(frame?.cmd!=="aibot_msg_callback"&&!(frame?.cmd==="aibot_event_callback"&&frame.body?.event?.eventtype==="template_card_event"))return;
  const verdict=ingress.check(frame);
  if(!verdict.ok){log("输入已拒绝",verdict.code);if(verdict.reply)await rawReply({...frame,__cardAction:frame.cmd==="aibot_event_callback",body:{...frame.body,chattype:frame.body.chattype||(frame.body.chatid?"group":"single")}},verdict.text).catch(()=>{});return;}
  try{if(await accessRequests.request(frame))return;if(await cards.handle(frame))return;return await observedRosterHandle(frame);}finally{verdict.release();}
};
const server=http.createServer((req,res)=>{if(accessRequests.local(req,res))return;if(!localRequest(req,profile.healthPort)){res.writeHead(403);res.end();return;}if(req.method==="GET"&&req.url==="/health"){res.writeHead(200,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify(health()));}else{res.writeHead(404);res.end();}});
server.on("error",()=>{log("排班端口占用或不可用，本实例退出");process.exit(1);});
let timer;
server.listen({port:profile.healthPort,host:"127.0.0.1",exclusive:true},()=>{
  if(!allowUsers.length && !(state.__operators||[]).length && !(state.__pairing?.expiresAt>Date.now())) {
    state.__pairing={code:String(crypto.randomInt(100000,1000000)),expiresAt:Date.now()+600_000};save(state);
  } else syncPairing(state);
  connection.start();timer=setInterval(async()=>{try{await controller.tick();await handoff?.tick();}catch{log("排班定时器异常，稍后重试");}},30000);log("排班专用实例已启动，只读且不调用模型");
});
function shutdown(){clearInterval(timer);connection.stop();server.close();process.exit(0);}
process.on("SIGINT",shutdown);process.on("SIGTERM",shutdown);
