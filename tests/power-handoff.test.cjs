const test=require("node:test"),assert=require("node:assert/strict");
const {createPowerHandoff,recipientFor,handoffSlot}=require("../lib/power-handoff.cjs");
function fixture(extra={}) {
  const state={__schedulePeople:{'["group-a","u1"]':"测试甲",'["private:u1","u1"]':"测试甲"}},sent=[];
  let at=new Date("2026-11-04T08:30:00Z"),reads=0,drafts=0;
  const args={state,save(){},schedule:async()=>{reads++;return {owner:"测试甲"};},draft:async()=>{drafts++;return "模拟草稿";},send:async(...v)=>sent.push(v),authorized:user=>user==="u1",enabledAt:"2026-11-03T10:00:00Z",now:()=>at,...extra};
  return {state,sent,args,c:createPowerHandoff(args),at:v=>{at=new Date(v);},reads:()=>reads,drafts:()=>drafts};
}
test("private reminder sends once for consistent group/private identity, including restart",async()=>{
 const f=fixture();await Promise.all([f.c.tick(),f.c.tick()]);assert.deepEqual(f.sent,[["u1","模拟草稿"]]);assert.equal(f.reads(),1);
 await createPowerHandoff(f.args).tick();assert.equal(f.sent.length,1);
 f.at("2026-11-04T23:30:00Z");await f.c.tick();assert.equal(f.sent.length,2);
});
test("no identity, no connection, early/late clock or late enable never sends obsolete drafts",async()=>{
 const f=fixture();for(const at of ["2026-11-04T08:29:59Z","2026-11-04T08:35:00Z","2026-11-04T23:35:00Z"]){f.at(at);await f.c.tick();}assert.equal(f.reads(),0);
 f.at("2026-11-04T08:30:00Z");delete f.state.__schedulePeople;await f.c.tick();assert.equal(f.reads(),0);
 const offline=fixture({ready:()=>false});await offline.c.tick();assert.equal(offline.reads(),0);
 const late=fixture({enabledAt:"2026-11-04T08:30:01Z"});await late.c.tick();assert.equal(late.reads(),0);
});
test("identity conflicts or revoked permission do not select a recipient or read ticket data",async()=>{
 const f=fixture();f.state.__schedulePeople['["group-b","u2"]']="测试甲";f.args.authorized=()=>true;
 await createPowerHandoff(f.args).tick();assert.equal(f.sent.length,0);assert.equal(f.drafts(),0);
 delete f.state.__schedulePeople['["group-b","u2"]'];f.state.__schedulePeople['["group-b","u1"]']="测试乙";
 assert.equal(recipientFor(f.state,"测试甲",()=>true),"");
 assert.equal(recipientFor({__schedulePeople:{u1:"测试甲"}},"测试甲",()=>false),"");
});
test("binding changed during generation prevents sending to the previous recipient",async()=>{
 const f=fixture();f.args.draft=async()=>{f.state.__schedulePeople={};return "draft";};await createPowerHandoff(f.args).tick();assert.equal(f.sent.length,0);
});
test("send intent must persist before network; unknown send result never retries",async()=>{
 const f=fixture({save:()=>{throw Error("disk");}});await f.c.tick();assert.equal(f.sent.length,0);
 let attempts=0;const u=fixture({send:async()=>{attempts++;throw Error("ack timeout");}});await u.c.tick();assert.equal(u.state.__powerHandoffDeliveries.white.status,"unknown");await createPowerHandoff(u.args).tick();assert.equal(attempts,1);
});
test("failed reads back off within five-minute slot and never publish stale data",async()=>{
 let reads=0;const f=fixture({schedule:async()=>{reads++;throw Error("read failed");}});await f.c.tick();await f.c.tick();assert.equal(reads,1);
 f.at("2026-11-04T08:31:00Z");await f.c.tick();assert.equal(reads,2);assert.equal(f.sent.length,0);
 f.at("2026-11-04T08:35:00Z");await f.c.tick();assert.equal(reads,2);
});
test("status is limited to the querying user, and morning window uses Shanghai clock",async()=>{
 const f=fixture();await f.c.tick();assert.match(f.c.status("u1"),/接口确认已发送/);assert.doesNotMatch(f.c.status("u2"),/接口确认已发送/);
 assert.equal(handoffSlot(new Date("2026-11-30T23:30:00Z")).date,"2026-12-01");
});
