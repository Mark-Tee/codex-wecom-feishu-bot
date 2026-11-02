const test = require("node:test");
const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {watchConnection} = require("../lib/connection-health.cjs");
const {createSupervisor,restartDelay} = require("../lib/bot-supervisor.cjs");
const {appendRotatingLog} = require("../lib/rotating-log.cjs");

test("silent connection closes once after90seconds; received frames reset deadline",()=>{
 let now=0,closed=0,warnings=0;const events=new EventEmitter();
 const socket={addEventListener:(n,f)=>events.on(n,f),removeEventListener:(n,f)=>events.off(n,f),terminate:()=>closed++};
 const health=watchConnection(socket,{now:()=>now,onTimeout:()=>warnings++});
 now=89_999;assert.equal(health.check(),false);events.emit("message");
 now=179_998;assert.equal(health.check(),false);now=179_999;assert.equal(health.check(),true);
 health.check();assert.equal(closed,1);assert.equal(warnings,1);
});
test("rotation retains bounded numbered log archives and leaves unrelated files",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"bot-log-test-"));
 try {
  const file=path.join(dir,"bridge.log"),legacy=file+".1";fs.writeFileSync(legacy,"legacy");
  for(let n=0;n<8;n++)appendRotatingLog(file,`line${n}\n`,{maxBytes:8,keep:2});
  assert.equal(fs.readFileSync(file,"utf8"),"line7\n");assert.equal(fs.readFileSync(path.join(dir,"bridge.2.log"),"utf8"),"line5\n");
  assert.equal(fs.readFileSync(legacy,"utf8"),"legacy");assert.equal(fs.readdirSync(dir).length,4);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test("supervisor restarts exits with backoff and does not mistake offline for dead",async()=>{
 let now=0,launches=0,kills=0,pending;
 const children=[];
 const supervisor=createSupervisor({now:()=>now,setTimer:(callback,ms)=>{pending={callback,ms};},clearTimer:()=>{},probe:async()=>({pid:children.at(-1).pid,authenticated:false,connectionStale:false}),spawnBridge:()=>{launches++;const child=new EventEmitter();child.pid=launches;child.kill=()=>{kills++;child.emit("exit",1);};children.push(child);return child;}});
 supervisor.launch();children[0].emit("exit",1);assert.equal(pending.ms,5000);pending.callback();assert.equal(launches,2);
 children[1].emit("exit",1);assert.equal(pending.ms,10000);pending.callback();now=150_000;await supervisor.check();assert.equal(kills,0);
 supervisor.stop();assert.equal(kills,1);assert.equal(restartDelay(99),300_000);
});
test("three failed localhost probes restart only the child owned by this guardian",async()=>{
 let now=0,kills=0;const child=new EventEmitter();child.pid=42;child.kill=()=>{kills++;};
 const supervisor=createSupervisor({now:()=>now,spawnBridge:()=>child,probe:async()=>{throw Error("timeout");}});
 supervisor.launch();now=120_000;await supervisor.check();await supervisor.check();assert.equal(kills,0);await supervisor.check();assert.equal(kills,1);supervisor.stop();
});
