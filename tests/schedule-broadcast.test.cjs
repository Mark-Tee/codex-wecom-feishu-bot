const test = require("node:test");
const assert = require("node:assert/strict");
const {createScheduleBroadcast} = require("../lib/schedule-broadcast.cjs");
const group = {body:{chattype:"group",chatid:"test-group"}};
function fixture(extra={}) {
  const state={__scheduleGroup:{chatid:"test-group",boundAt:"2026-11-01T00:00:00Z"}};
  const sent=[],replies=[];
  let at=new Date("2026-11-02T00:20:00Z"),reads=0;
  const args={state,save:()=>{},read:async()=>{reads++;return "fresh";},send:async(...v)=>sent.push(v),reply:async(_,text)=>replies.push(text),now:()=>at,...extra};
  const c=createScheduleBroadcast(args);
  return {c,state,sent,replies,args,setTime:(v)=>{at=new Date(v);},reads:()=>reads};
}
test("08:20 fresh read, group send, persistent duplicate guard",async()=>{
 const f=fixture();f.setTime("2026-11-02T00:19:00Z");await f.c.tick();assert.equal(f.reads(),0);
 f.setTime("2026-11-02T00:20:00Z");await Promise.all([f.c.tick(),f.c.tick()]);assert.equal(f.sent.length,1);assert.equal(f.sent[0][1],2);
 await createScheduleBroadcast(f.args).tick();assert.equal(f.sent.length,1);
 f.setTime("2026-11-03T00:20:00Z");await f.c.tick();assert.equal(f.sent.length,2);
});
test("no binding or disconnected means no read/send",async()=>{
 const f=fixture({ready:()=>false});await f.c.tick();assert.equal(f.reads(),0);
 delete f.state.__scheduleGroup;await f.c.tick();assert.equal(f.sent.length,0);
});
test("failed read retries after five minutes and never sends stale",async()=>{
 let calls=0;const f=fixture({read:async()=>{calls++;throw Error("offline");}});
 await f.c.tick();await f.c.tick();assert.equal(calls,1);assert.equal(f.sent.length,0);
 f.setTime("2026-11-02T00:25:00Z");await f.c.tick();assert.equal(calls,2);
});
test("uncertain send must not duplicate even after restart",async()=>{
 let calls=0;const f=fixture({send:async()=>{calls++;throw Error("timeout");}});
 await f.c.tick();assert.equal(f.state.__scheduleDelivery.status,"unknown");await createScheduleBroadcast(f.args).tick();assert.equal(calls,1);
});
test("binding is group-only and does not silently replace another group",async()=>{
 const f=fixture();await f.c.command({body:{chattype:"single",chatid:"private"}},"绑定排班群");assert.equal(f.state.__scheduleGroup.chatid,"test-group");
 await f.c.command({body:{chattype:"group",chatid:"another"}},"绑定排班群");assert.equal(f.state.__scheduleGroup.chatid,"test-group");
 await f.c.command(group,"解绑排班群");assert.equal(f.state.__scheduleGroup,undefined);
 await f.c.command(group,"绑定排班群");await f.c.tick();assert.equal(f.sent.length,0);
 await f.c.command(group,"查看排班");assert.deepEqual(f.replies.slice(-1),["fresh"]);
});
