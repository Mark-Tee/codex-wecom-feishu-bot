const test=require("node:test"),assert=require("node:assert/strict");
const {progressReader,createTaskProgress,taskStreamId}=require("../lib/task-progress.cjs");
test("stage protocol tolerates chunks and ignores unknown or malformed data",()=>{
 const stages=[],read=progressReader(stage=>stages.push(stage));read('other log\n@@BOT_STA');read('GE {"stage":"recognizing"}\n@@BOT_STAGE {"stage":"/forget"}\n@@BOT_STAGE nope\n');read('@@BOT_STAGE {"stage":"checking"}\n');assert.deepEqual(stages,["recognizing","checking"]);
});
test("one task serializes ACKs, never regresses and never overwrites final success/failure",async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;}),sent=[];let active=0,maximum=0;
 const progress=createTaskProgress(async(text,finish)=>{maximum=Math.max(maximum,++active);if(!sent.length){sent.push({text,finish});await gate;}else sent.push({text,finish});active--;});
 const start=progress.start();await new Promise(resolve=>setImmediate(resolve));progress.stage("recognizing");progress.stage("checking");progress.stage("recognizing");const end=progress.finish("登记未完成，请核验");progress.heartbeat(99);progress.stage("checking");release();await Promise.all([start,end]);
 assert.equal(maximum,1);assert.equal(sent.length,4);assert.equal(sent.at(-1).text,"登记未完成，请核验");assert.equal(sent.at(-1).finish,true);assert(!sent.some(row=>row.text.includes("已登记")));
});
test("queue and worker share a stable per-message stream, separate messages never share it",()=>{
 assert.equal(taskStreamId({body:{msgid:"one"}}),taskStreamId({body:{msgid:"one"},headers:{req_id:"changed"}}));assert.notEqual(taskStreamId({body:{msgid:"one"}}),taskStreamId({body:{msgid:"two"}}));
});
