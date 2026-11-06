const test=require("node:test"),assert=require("node:assert/strict");
const {createInteractionCards}=require("../lib/interaction-cards.cjs");
function fixture({role="ticket",state={},fail}={}){
 const calls=[],replies=[],dispatched=[];let persisted,authorized=true,at=1000;
 const cards=createInteractionCards({role,state,save:value=>{persisted=structuredClone(value);},authorized:()=>authorized,now:()=>at,help:"完整指令",send:async(cmd,body,rid)=>{calls.push({cmd,body:structuredClone(body),rid});if(fail)throw Error(fail);},reply:async(frame,text)=>replies.push({frame,text}),dispatch:async frame=>dispatched.push(frame)});
 const frame={cmd:"aibot_msg_callback",headers:{req_id:"menu-request"},body:{msgid:"menu",msgtype:"text",chattype:"group",chatid:"g1",from:{userid:"u1"}}};
 const click=(id,key,msgid="click")=>({cmd:"aibot_event_callback",headers:{req_id:msgid},body:{...frame.body,msgid,msgtype:"event",event:{eventtype:"template_card_event",task_id:id,event_key:key}}});
 return {cards,state,calls,replies,dispatched,frame,click,persisted:()=>persisted,revoke:()=>{authorized=false;},expire:()=>{at+=3600001;}};
}

test("expired clicks produce a new visible instruction in the original private chat",async()=>{
 const f=fixture({role:"roster"});f.frame.body.chattype="single";delete f.frame.body.chatid;
 await f.cards.menu(f.frame);const id=f.calls[0].body.template_card.task_id;f.expire();
 const event=f.click(id,"m2");delete event.body.chattype;delete event.body.chatid;
 await f.cards.handle(event);assert.equal(f.dispatched.length,0);assert.equal(f.replies.length,1);assert.match(f.replies[0].text,/失效.*菜单/);assert.equal(f.replies[0].frame.body.chattype,"single");assert.equal(f.replies[0].frame.__cardAction,true);
});

test("unknown card ACK gives explicit next step and never dispatches or replays a clear",async()=>{
 const original=fixture();await original.cards.menu(original.frame);const id=original.calls[0].body.template_card.task_id;
 const f=fixture({state:original.persisted(),fail:"ack timeout"});await assert.rejects(f.cards.handle(f.click(id,"m2")),/timeout/);assert.equal(f.dispatched.length,0);assert.equal(f.replies.length,1);assert.match(f.replies[0].text,/未.*执行|未.*继续/);assert.match(f.replies[0].text,/菜单/);
});

test("every menu button maps to the documented query or preview in both conversation types",async()=>{
 const expected={roster:["班","今","明","休","我",null],ticket:["单","继续","清全部","状态",null]};
 for(const role of ["roster","ticket"])for(const type of ["group","single"])for(const [index,command] of expected[role].entries()){
  const f=fixture({role});f.frame.body.chattype=type;if(type==="single")delete f.frame.body.chatid;
  await f.cards.menu(f.frame);const card=f.calls[0].body.template_card;await f.cards.handle(f.click(card.task_id,"m"+index));
  if(command===null){assert.equal(f.dispatched.length,0);assert.equal(f.replies.at(-1).text,"完整指令");}
  else{assert.equal(f.dispatched.length,1);assert.equal(f.dispatched[0].body.text.content,command);assert.equal(f.dispatched[0].body.chattype,type);}
 }
});
test("menus use official payload, only original safe commands, ACK precedes original routing",async()=>{
 for(const role of ["roster","ticket"]){const f=fixture({role});await f.cards.menu(f.frame);const card=f.calls[0].body.template_card;assert.match(card.task_id,/^ui_[a-f0-9]{32}$/);assert(card.button_list.length<=6);assert.equal(f.calls[0].cmd,"aibot_respond_msg");
 await f.cards.handle(f.click(card.task_id,card.button_list[0].key));assert.equal(f.calls[1].cmd,"aibot_respond_update_msg");assert.deepEqual(f.calls[1].body.userids,["u1"]);assert.equal(f.calls[1].body.template_card.card_type,"button_interaction");assert.equal(f.dispatched.length,1);assert.equal(f.dispatched[0].__cardAction,true);assert.equal(f.dispatched[0].body.text.content,role==="roster"?"班":"单");
 assert(!card.button_list.some(button=>/授权|停止|删除文件/.test(button.text)));}
});
test("owner, conversation, role, expiration, authorization and forged key are rechecked",async()=>{
 for(const change of [e=>{e.body.from.userid="u2";},e=>{e.body.chatid="g2";},e=>{e.body.chattype="single";},e=>{e.body.event.event_key="/forget confirm";},(e,f)=>{f.expire();},(e,f)=>{f.revoke();},(e,f)=>{f.state.__interactionCards[e.body.event.task_id].role="roster";}]){
  const f=fixture();await f.cards.menu(f.frame);const card=f.calls[0].body.template_card,event=f.click(card.task_id,"m0");change(event,f);await f.cards.handle(event);assert.equal(f.dispatched.length,0);assert.equal(f.calls.at(-1).cmd,"aibot_respond_update_msg");
 }
});
test("callback replay and one-shot clear confirmation survive persistence; stale card never runs raw command",async()=>{
 const f=fixture(),token="a".repeat(64),text="将清除本人2条待办：1、2；在线记录不删除。";assert.equal(await f.cards.confirmation(f.frame,text,{kind:"forget-confirm",token}),true);
 const card=f.calls[0].body.template_card;assert.equal(card.sub_title_text,text);await f.cards.handle(f.click(card.task_id,"confirm"));assert.equal(f.dispatched[0].body.text.content,`/forget confirm ${token}`);
 const restarted=fixture({state:f.persisted()});await restarted.cards.handle(restarted.click(card.task_id,"confirm","new-click"));assert.equal(restarted.dispatched.length,0);
 await restarted.cards.handle(restarted.click(card.task_id,"status","status-click"));assert.equal(restarted.dispatched.length,1);assert.equal(restarted.dispatched[0].body.text.content,"单");assert.equal(restarted.calls.at(-1).body.template_card.card_type,"button_interaction");assert(restarted.calls.at(-1).body.template_card.button_list.length>0);
 const menu=fixture();await menu.cards.menu(menu.frame);const id=menu.calls[0].body.template_card.task_id;const event=menu.click(id,"m0");await menu.cards.handle(event);await menu.cards.handle(event);assert.equal(menu.dispatched.length,1);
});
test("only explicit card rejection falls back; unknown ACK never dispatches or auto-retries",async()=>{
 const failed=fixture({fail:"ack errcode 40008"});await failed.cards.menu(failed.frame);assert.equal(failed.replies.length,1);assert.equal(failed.replies[0].text,"完整指令");
 const unknown=fixture({fail:"ack timeout"});await assert.rejects(unknown.cards.menu(unknown.frame),/timeout/);assert.equal(unknown.replies.length,0);
 const state=fixture();await state.cards.menu(state.frame);const id=state.calls[0].body.template_card.task_id;const timeout=fixture({state:state.persisted(),fail:"ack timeout"});await assert.rejects(timeout.cards.handle(timeout.click(id,"m0")),/timeout/);assert.equal(timeout.dispatched.length,0);
 assert.equal(await state.cards.confirmation(state.frame,"过长清单".repeat(60),{kind:"forget-confirm",token:"a".repeat(64)}),false);
});
test("help button produces plain help and proactive cards retain the original destination",async()=>{
 const f=fixture();await f.cards.menu(f.frame);const card=f.calls[0].body.template_card,help=card.button_list.find(button=>button.text==="指令说明");await f.cards.handle(f.click(card.task_id,help.key));assert.equal(f.dispatched.length,0);assert.equal(f.replies[0].frame.__plainHelp,true);assert.equal(f.replies[0].frame.__cardAction,true);
 await f.cards.menu({...f.frame,__cardAction:true});assert.equal(f.calls.at(-1).cmd,"aibot_send_msg");assert.equal(f.calls.at(-1).body.chatid,"g1");
});

test("documented optional event chat type is resolved from chat ID, unauthorized menus do not mint capabilities",async()=>{
 const f=fixture();await f.cards.menu(f.frame);const id=f.calls[0].body.template_card.task_id,event=f.click(id,"m0");delete event.body.chattype;await f.cards.handle(event);assert.equal(f.dispatched[0].body.chattype,"group");
 const denied=fixture();denied.revoke();await denied.cards.menu(denied.frame);assert.equal(denied.state.__interactionCards,undefined);assert.equal(denied.replies.length,1);
});

test("real nested callback fields work, conflicting envelopes never execute",async()=>{
 const f=fixture();await f.cards.menu(f.frame);const id=f.calls[0].body.template_card.task_id,event=f.click(id,"m0");event.body.event={eventtype:"template_card_event",template_card_event:{task_id:id,event_key:"m0",card_type:"button_interaction"}};await f.cards.handle(event);assert.equal(f.dispatched.length,1);
 event.body.msgid="conflict";event.body.event.task_id="other";await f.cards.handle(event);assert.equal(f.dispatched.length,1);
});
