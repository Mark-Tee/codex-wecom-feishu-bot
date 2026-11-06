const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const {createObservability,errorCategory}=require("../lib/observability.cjs");
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),"bot-observation-"));
const frame=(text,extra={})=>({body:{msgid:"private-message",chattype:"group",chatid:"private-group",from:{userid:"private-account"},msgtype:"text",text:{content:text}},...extra});
test("only anonymous allowlisted fields persist, deferred work includes download/queue time and cannot finish twice",()=>{
 const root=temp();let clock=1800000000000;const tracker=createObservability({root,role:"ticket",now:()=>clock});
 const request=frame("人 机密姓名",{__observedAt:clock-5000});tracker.start(request);tracker.start(request);tracker.defer(request);tracker.finish(request);clock+=2000;tracker.mark(request,"registration_verified");tracker.finish(request,"worker_returned",true);tracker.finish(request,"failed",true);
 tracker.record({type:"error",error:"机密姓名",text:"private-token"});tracker.record({type:"error",error:"timeout",text:"private-token",account:"private-account"});tracker.record({type:"result",outcome:"private-account"});tracker.close();
 const data=fs.readFileSync(path.join(root,"logs/observability/events.log"),"utf8"),events=data.trim().split("\n").map(JSON.parse),report=fs.readFileSync(path.join(root,"logs/observability/report.md"),"utf8");
 assert.equal(events.length,3);assert.equal(events[0].category,"identity");assert.equal(events[1].durationMs,7000);assert.equal(events[1].outcome,"registration_verified");assert.equal(events[2].error,"timeout");
 for(const secret of ["机密姓名","private-account","private-group","private-message","private-token"])assert(!(data+report).includes(secret));
 assert.match(report,/登记≤60秒：1\/1/);assert.equal(tracker.status().dropped,0);
});
test("readback report rejects tampered raw fields and ignores expired samples, including across restart",()=>{
 const root=temp(),at=1800000000000,dir=path.join(root,"logs/observability");fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,"events.log"),[
  {v:1,at,role:"roster",type:"usage",category:"机密姓名",form:"private-token"},
  {v:1,at:at-31*86400000,role:"roster",type:"result",outcome:"failed",durationMs:50},
  {v:1,at,role:"roster",type:"usage",category:"leave",form:"private-token",input:"private-account",channel:"private-group"}
 ].map(JSON.stringify).join("\n"));
 const tracker=createObservability({root,role:"roster",now:()=>at});assert(tracker.flush());tracker.close();const report=fs.readFileSync(path.join(dir,"report.md"),"utf8");for(const secret of ["机密姓名","private-token","private-account","private-group"])assert(!report.includes(secret));assert.match(report,/请假调休查询：1/);assert(!report.includes("程序处理失败：1"));
});
test("collector storage failures never throw into a business task, errors are static categories",()=>{
 const root=temp();fs.writeFileSync(path.join(root,"logs"),"blocked");const tracker=createObservability({root,role:"ticket"});assert.doesNotThrow(()=>{const request=frame("单");tracker.start(request);tracker.finish(request);tracker.system(["duty agent failed","Cannot find module private-token"]);tracker.close();});assert(tracker.status().dropped>0);
 assert.equal(errorCategory(Error("Cannot find module private-path")),"module_missing");assert.equal(errorCategory(Error("secret request timeout")),"timeout");assert.equal(errorCategory(Error("my token")),"runtime");
});
test("log rotation remains bounded and touches only telemetry log names",()=>{
 const root=temp(),dir=path.join(root,"logs/observability");fs.mkdirSync(dir,{recursive:true});for(const name of ["events.log",...Array.from({length:5},(_,i)=>`events.${i+1}.log`)])fs.writeFileSync(path.join(dir,name),"x".repeat(1024*1024));fs.writeFileSync(path.join(dir,"unrelated.md"),"keep");const tracker=createObservability({root,role:"ticket"});tracker.record({type:"error",error:"runtime"});tracker.close();assert.equal(fs.readdirSync(dir).filter(name=>/^events(?:\.\d)?\.log$/.test(name)).length,6);assert.equal(fs.readFileSync(path.join(dir,"unrelated.md"),"utf8"),"keep");
});
