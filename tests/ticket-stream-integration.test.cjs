const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
const {createTaskProgress,taskStreamId}=require("../lib/task-progress.cjs");
const source=fs.readFileSync(process.env.BOT_ENTRY_UNDER_TEST||path.join(__dirname,"../bridge.cjs"),"utf8");
const section=(start,end)=>{const at=source.indexOf(start),until=source.indexOf(end,at);assert(at>=0&&until>at);return source.slice(at,until);};
test("gateway persists only typed worker outcomes, not reply contents or injected values",async()=>{
 const os=require("node:os"),{createObservability}=require("../lib/observability.cjs");
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"bot-gateway-observation-"));let clock=1800000000000;
 const observability=createObservability({root,role:"ticket",now:()=>clock}),frame={__observedAt:clock-5000,body:{msgtype:"image",msgid:"private-id",chattype:"group",chatid:"private-chat",from:{userid:"private-user"}}};observability.start(frame);observability.defer(frame);
 const context={observability,createTaskProgress,taskStreamId,Date,reqId:()=>"id",localTimestamp:()=>"offline",interactionCards:{confirmation:async()=>false},truncate:text=>text,log(){},dutyErrorReply:error=>error.message,replyStream:async()=>{},setInterval:()=>1,clearInterval(){},runDutyAgent:async()=>{clock+=1000;return {replies:[{kind:"final",text:"private-token"}],observations:["registration_verified","private-name"],errors:["timeout","private-path"]};}};
 const sandbox=vm.createContext(context);vm.runInContext(section('async function processDutyAgentTask(','\nasync function processDutyDraftTask('),sandbox);await sandbox.processDutyAgentTask({frame,prompt:"图片",chatKey:"private-chat",userId:"private-user",images:["private-image"]});observability.close();
 const data=fs.readFileSync(path.join(root,"logs/observability/events.log"),"utf8");const events=data.trim().split("\n").map(JSON.parse);assert.equal(events.filter(item=>item.type==="result").length,1);assert(events.some(item=>item.outcome==="registration_verified"&&item.durationMs===6000));assert(events.some(item=>item.error==="timeout"));assert(!data.includes("private-"));
});
test("real gateway queue, recognition, checks and final receipt keep one stream and wait for queue ACK",async()=>{
 const sent=[],taskQueue=[];let release,workerCalls=0;const ack=new Promise(resolve=>{release=resolve;});
 const frame={headers:{req_id:"r"},body:{msgid:"photo",chattype:"group",chatid:"g1",from:{userid:"u1"}}};
 const context={observability:{defer(){},mark(){},record(){},finish(){}},frame,prompt:"图片工单",chatKey:"chat",userId:"u1",images:["fake.jpg"],ocrText:"",cfg:{dutyAgent:{enabled:true}},taskQueue,jobRunning:true,createTaskProgress,taskStreamId,Date,reqId:()=>"id",localTimestamp:()=>"2026-11-03T09:00:00+08:00",interactionCards:{confirmation:async()=>false},truncate:text=>text,log(){},dutyErrorReply:error=>error.message,dutyAgentConfigError:()=>"",replyStream:async(f,id,text,finish)=>{sent.push({id,text,finish});if(sent.length===1)await ack;},setInterval:()=>1,clearInterval(){},drainQueue:async()=>{},runDutyAgent:async(message,{onStage})=>{workerCalls++;onStage("recognizing");onStage("checking");return {replies:[{kind:"final",text:"登记结果已核验"}]};}};
 const sandbox=vm.createContext(context),block=section('  if (useDutyAgent) {','\n  let dutyDraft;');
 vm.runInContext('async function enqueue(){const useDutyAgent=true;'+block+'}\n'+section('async function processDutyAgentTask(','\nasync function processDutyDraftTask('),sandbox);
 const queued=sandbox.enqueue();await new Promise(resolve=>setImmediate(resolve));assert.equal(taskQueue.length,1);assert.equal(sent.length,1);
 const processing=sandbox.processDutyAgentTask(taskQueue[0]);await new Promise(resolve=>setImmediate(resolve));assert.equal(workerCalls,0);assert.equal(sent.length,1);
 release();await Promise.all([queued,processing]);assert.equal(workerCalls,1);assert.equal(new Set(sent.map(row=>row.id)).size,1);assert.equal(sent[0].finish,false);assert.equal(sent.at(-1).finish,true);assert.equal(sent.at(-1).text,"登记结果已核验");assert(sent.some(row=>row.text.includes("核对飞书")));
});
test("callback results use original chat proactive delivery; no invalid streaming reply to an event",async()=>{
 const sent=[],context={MAX_REPLY_BYTES:4000,send:async(cmd,body)=>sent.push({cmd,body}),frameId:frame=>frame.headers.req_id,log(){}};const sandbox=vm.createContext(context);
 vm.runInContext(section('async function replyStream(','\nasync function replyText('),sandbox);
 const frame={__cardAction:true,body:{chattype:"single",from:{userid:"u1"}},headers:{req_id:"event"}};
 await sandbox.replyStream(frame,"id","处理中",false);assert.equal(sent.length,0);await sandbox.replyStream(frame,"id","本人待办",true);assert.equal(sent[0].cmd,"aibot_send_msg");assert.equal(sent[0].body.chatid,"u1");assert.equal(sent[0].body.chat_type,1);
});
