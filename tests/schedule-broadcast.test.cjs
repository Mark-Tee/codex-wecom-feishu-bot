const test = require("node:test");
const assert = require("node:assert/strict");
const {createScheduleBroadcast} = require("../lib/schedule-broadcast.cjs");
const group = {body:{chattype:"group",chatid:"test-group"}};
function fixture(extra={}) {
  const state={__scheduleGroup:{chatid:"test-group",boundAt:"2026-11-01T00:00:00Z"}};
  const sent=[],replies=[];
  let at=new Date("2026-11-01T23:00:00Z"),reads=0;
  const args={state,save:()=>{},read:async()=>{reads++;return "fresh";},send:async(...v)=>sent.push(v),reply:async(_,text)=>replies.push(text),now:()=>at,...extra};
  const c=createScheduleBroadcast(args);
  return {c,state,sent,replies,args,setTime:(v)=>{at=new Date(v);},reads:()=>reads};
}
test("07:00 fresh read, group send, persistent duplicate guard",async()=>{
 const f=fixture();f.setTime("2026-11-01T22:59:00Z");await f.c.tick();assert.equal(f.reads(),0);
 f.setTime("2026-11-01T23:00:00Z");await Promise.all([f.c.tick(),f.c.tick()]);assert.equal(f.sent.length,1);assert.equal(f.sent[0][1],2);
 await createScheduleBroadcast(f.args).tick();assert.equal(f.sent.length,1);
 f.setTime("2026-11-02T23:00:00Z");await f.c.tick();assert.equal(f.sent.length,2);
});
test("no binding or disconnected means no read/send",async()=>{
 const f=fixture({ready:()=>false});await f.c.tick();assert.equal(f.reads(),0);
 delete f.state.__scheduleGroup;await f.c.tick();assert.equal(f.sent.length,0);
});
test("failed read retries after five minutes and never sends stale",async()=>{
 let calls=0;const f=fixture({read:async()=>{calls++;throw Error("offline");}});
 await f.c.tick();await f.c.tick();assert.equal(calls,1);assert.equal(f.sent.length,0);
 f.setTime("2026-11-01T23:05:00Z");await f.c.tick();assert.equal(calls,2);
});
test("uncertain send must not duplicate even after restart",async()=>{
 let calls=0;const f=fixture({send:async()=>{calls++;throw Error("timeout");}});
 await f.c.tick();assert.equal(f.state.__scheduleDeliveries.morning.status,"unknown");await createScheduleBroadcast(f.args).tick();assert.equal(calls,1);
});
test("binding is group-only and does not silently replace another group",async()=>{
 const f=fixture();await f.c.command({body:{chattype:"single",chatid:"private"}},"绑定排班群");assert.equal(f.state.__scheduleGroup.chatid,"test-group");
 await f.c.command({body:{chattype:"group",chatid:"another"}},"绑定排班群");assert.equal(f.state.__scheduleGroup.chatid,"test-group");
 await f.c.command(group,"解绑排班群");assert.equal(f.state.__scheduleGroup,undefined);
 await f.c.command(group,"绑定排班群");await f.c.tick();assert.equal(f.sent.length,0);
 await f.c.command(group,"查看排班");assert.match(f.replies.at(-1),/fresh$/);
});
test("personal identity is per sender and scheduled broadcasts never inherit it",async()=>{
 const selections=[];const f=fixture({members:async()=>["测试甲","测试乙"],read:async(_,selection)=>{selections.push(selection);return "fresh";}});
 const a={body:{chattype:"group",chatid:"test-group",from:{userid:"user-a"}}};
 const b={body:{chattype:"group",chatid:"test-group",from:{userid:"user-b"}}};
 await f.c.command(a,"排班身份 测试甲");await f.c.command(b,"排班身份 测试乙");
 await f.c.command(a,"查看排班");await f.c.command(b,"查看排班");
 await createScheduleBroadcast(f.args).command(a,"查看排班");
 await f.c.tick();assert.deepEqual(selections,[{viewer:"测试甲"},{viewer:"测试乙"},{viewer:"测试甲"},{offsets:[0]}]);
 await f.c.command(a,"排班身份 猜测名");assert.equal(f.state.__schedulePeople[JSON.stringify(["test-group","user-a"])],"测试甲");
 await f.c.command({body:{chattype:"group",chatid:"test-group"}},"排班身份 测试甲");assert.match(f.replies.at(-1),/未取得发起人/);
 assert.equal(await f.c.command(a,"排班身份 测试 甲"),true);assert.match(f.replies.at(-1),/用法/);
});
test("multiword mention residue uses the live roster reader and the sender identity",async()=>{
 const selections=[];const f=fixture({members:async()=>["测试甲"],read:async(_,selection)=>{selections.push(selection);return "在线排班";}});
 const frame={body:{chattype:"group",chatid:"test-group",from:{userid:"user-a"}}};
 assert.equal(await f.c.command(frame,"BOT 排班身份 测试甲"),true);
 assert.equal(await f.c.command(frame,"BOT 查看排班"),true);
 assert.deepEqual(selections,[{viewer:"测试甲"}]);assert.equal(f.replies.at(-1),"在线排班");
 assert.equal(await f.c.command(frame,"BOT 请解释排班实现"),false);
});

test("morning and evening select one date, each deduplicates independently", async()=>{
 const selected=[];const f=fixture({read:async(_,options)=>{selected.push(options.offsets);return "fresh";}});
 await f.c.tick();f.setTime("2026-11-02T08:59:00Z");await f.c.tick();assert.equal(f.sent.length,1);
 f.setTime("2026-11-02T09:00:00Z");await f.c.tick();await createScheduleBroadcast(f.args).tick();
 assert.equal(f.sent.length,2);assert.deepEqual(selected,[[0],[1]]);
 assert.equal(f.state.__scheduleDeliveries.morning.status,"sent");assert.equal(f.state.__scheduleDeliveries.evening.status,"sent");
});
test("binding after morning still allows evening; restart after17 only catches evening", async()=>{
 const f=fixture();delete f.state.__scheduleGroup;f.setTime("2026-11-02T01:00:00Z");await f.c.command(group,"绑定排班群");await f.c.tick();assert.equal(f.sent.length,0);
 f.setTime("2026-11-02T09:00:00Z");await f.c.tick();assert.equal(f.sent.length,1);
 const selected=[];const late=fixture({read:async(_,options)=>{selected.push(options.offsets);return "fresh";}});late.setTime("2026-11-02T10:00:00Z");await late.c.tick();assert.deepEqual(selected,[[1]]);
});


test("identity aliases and date queries remain isolated across groups and survive restart",async()=>{
 const selections=[];const f=fixture({members:async()=>["测试甲","测试乙"],read:async(_,options)=>{selections.push(options);return "fresh";}});
 const frame=(group,user)=>({body:{chattype:"group",chatid:group,from:{userid:user}}});
 await f.c.command(frame("a","u"),"我是测试甲");await f.c.command(frame("b","u"),"我是测试乙");
 const c=createScheduleBroadcast(f.args);
 await c.command(frame("a","u"),"我今天什么班");await c.command(frame("b","u"),"我明天什么班");await c.command(frame("a","v"),"查看排班");
 assert.deepEqual(selections,[{viewer:"测试甲",offsets:[0]},{viewer:"测试乙",offsets:[1]},{viewer:""}]);
});

test("private roster confirms own identity and never inherits group identity silently",async()=>{
 const views=[];const f=fixture({members:async()=>["测试甲"],read:async(_,v)=>{views.push(v);return "fresh";}});
 const g={body:{chattype:"group",chatid:"g",from:{userid:"u"}}},p={body:{chattype:"single",from:{userid:"u"}}};
 await f.c.command(g,"排班身份 测试甲");await f.c.command(p,"查看排班");assert.equal(views.length,0);assert.match(f.replies.at(-1),/沿用/);
 await f.c.command(p,"是");await f.c.command(p,"我明天什么班");assert.deepEqual(views,[{viewer:"测试甲",offsets:[1]}]);
 await f.c.command(p,"绑定排班群");assert.equal(f.state.__scheduleGroup.chatid,"test-group");
});

test("leave check uses bound sender only, supports explicit dates and refuses malformed arguments",async()=>{
 const checks=[];const f=fixture({members:async()=>["测试甲"],readLeave:async(_,selection)=>{checks.push(selection);return "未命中本条限制，不代表请假已批准";}});
 const a={body:{chattype:"group",chatid:"test-group",from:{userid:"a"}}},b={body:{chattype:"group",chatid:"test-group",from:{userid:"b"}}};
 await f.c.command(a,"排班身份 测试甲");await f.c.command(a,"BOT 请假检查 明天");await f.c.command(a,"调休检查 2026-11-04");await f.c.command(a,"请假检查");
 assert.deepEqual(checks,[{viewer:"测试甲",date:"明天"},{viewer:"测试甲",date:"2026-11-04"},{viewer:"测试甲",date:"今天"}]);
 await f.c.command(b,"请假检查 明天");assert.match(f.replies.at(-1),/尚未绑定/);assert.equal(checks.length,3);
 await f.c.command(a,"请假检查 测试乙 明天");assert.match(f.replies.at(-1),/用法/);assert.equal(checks.length,3);
 assert.equal(f.sent.length,0);
});

test("monthly candidate questions keep each sender and group identity isolated",async()=>{
 const calls=[];const f=fixture({members:async()=>["测试甲","测试乙"],readCandidates:async(_,selection)=>{calls.push(selection);return "本月候选日";}});
 const frame=(chatid,user)=>({body:{chattype:"group",chatid,from:{userid:user}}});
 await f.c.command(frame("a","u"),"排班身份 测试甲");await f.c.command(frame("b","u"),"排班身份 测试乙");
 await f.c.command(frame("a","u"),"我哪几天可以用来请假调休");await f.c.command(frame("b","u"),"调休候选 2026-12");
 assert.deepEqual(calls,[{viewer:"测试甲",month:"本月"},{viewer:"测试乙",month:"2026-12"}]);
 await f.c.command(frame("a","other"),"请假候选");assert.match(f.replies.at(-1),/尚未绑定/);await f.c.command(frame("a","u"),"请假候选 测试乙");assert.match(f.replies.at(-1),/用法/);assert.equal(calls.length,2);assert.equal(f.sent.length,0);
});
