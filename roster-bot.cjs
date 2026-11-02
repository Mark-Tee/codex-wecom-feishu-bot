#!/usr/bin/env node
// Dedicated read-only roster entry point. No Codex runner, Feishu browser or ticket worker.
const fs=require("node:fs"),path=require("node:path"),http=require("node:http"),crypto=require("node:crypto");
const {pathToFileURL}=require("node:url");
const {readServiceProfile}=require("./lib/service-profile.cjs");
const {appendRotatingLog}=require("./lib/rotating-log.cjs");
const {WeComLongConnection}=require("./lib/wecom-long-connection.cjs");
const {createScheduleBroadcast}=require("./lib/schedule-broadcast.cjs");
const {createRosterService}=require("./lib/roster-service.cjs");
const ROOT=__dirname,profile=readServiceProfile(ROOT);
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
function log(...values){const text=values.map(String).join(" ").replaceAll(config.botId,"[robot]").replaceAll(config.secret,"[credential]");try{appendRotatingLog(path.join(ROOT,"logs","roster.log"),`[${new Date().toISOString()}] ${text}\n`);}catch{}}
let WS;try{WS=require("ws");}catch{try{WS=require(path.join(ROOT,"vendor","ws"));}catch{WS=globalThis.WebSocket;}}
let handle;
const connection=new WeComLongConnection({WebSocketImpl:WS,url:"wss://openws.work.weixin.qq.com",botId:config.botId,secret:config.secret,log,parseFrame:raw=>{try{return JSON.parse(raw);}catch{return null;}},onFrame:frame=>handle(frame).catch(()=>log("排班消息处理失败，请重试"))});
const reply=(frame,text)=>connection.send("aibot_respond_msg",{msgtype:"stream",stream:{id:connection.requestId("roster"),finish:true,content:text}},frame.headers?.req_id);
const business=()=>{const source=JSON.parse(fs.readFileSync(businessConfigPath,"utf8").replace(/^\uFEFF/,""));return {sources:{mode:source.sources.mode,online:{schedule:source.sources.online.schedule}},schedule:source.schedule,site_rules:source.site_rules};};
const load=(relative)=>import(pathToFileURL(path.join(rulesRoot,relative)).href);
const controller=createScheduleBroadcast({state,save,reply,send:(chatid,chatType,text)=>connection.send("aibot_send_msg",{chatid,chat_type:chatType,msgtype:"markdown",markdown:{content:text}}),ready:()=>connection.authenticated,log,members:async()=>business().site_rules.departments.flatMap(group=>group.members),read:async(at,selection={})=>{
  const {TencentDocsClient}=await load("src/providers/tencent-docs/client.mjs");
  const {readScheduleBroadcast,formatScheduleBroadcast}=await load("src/providers/tencent-docs/schedule-broadcast.mjs");
  const client=new TencentDocsClient();
  const readOnly=Object.freeze({getSheetInfo:client.getSheetInfo.bind(client),getCsv:client.getCsv.bind(client),getStyles:client.getStyles.bind(client)});
  return formatScheduleBroadcast(await readScheduleBroadcast({client:readOnly,config:business(),at,...selection}),{viewer:selection.viewer||""});
}});
const health=()=>({service:"codex-wecom-bridge",serviceId:crypto.createHash("sha256").update(ROOT).digest("hex"),role:"roster",pid:process.pid,authenticated:connection.authenticated,uptimeSeconds:Math.floor(process.uptime()),busy:false,connectionStale:Boolean(connection.healthWatch&&Date.now()-connection.healthWatch.snapshot().lastReceivedAt>300_000)});
handle=createRosterService({state,save,controller,reply,health,allowUsers,makeCode:()=>String(crypto.randomInt(100000,1000000))});
const server=http.createServer((req,res)=>{if(req.method==="GET"&&req.url==="/health"){res.writeHead(200,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify(health()));}else{res.writeHead(404);res.end();}});
server.on("error",()=>{log("排班端口占用或不可用，本实例退出");process.exit(1);});
let timer;
server.listen({port:profile.healthPort,host:"127.0.0.1",exclusive:true},()=>{
  if(!allowUsers.length && !(state.__operators||[]).length && !(state.__pairing?.expiresAt>Date.now())) {
    state.__pairing={code:String(crypto.randomInt(100000,1000000)),expiresAt:Date.now()+600_000};save(state);
  } else syncPairing(state);
  connection.start();timer=setInterval(()=>controller.tick().catch(()=>log("排班定时器异常，稍后重试")),30000);log("排班专用实例已启动，只读且不调用模型");
});
function shutdown(){clearInterval(timer);connection.stop();server.close();process.exit(0);}
process.on("SIGINT",shutdown);process.on("SIGTERM",shutdown);
