import test from "node:test";
import assert from "node:assert/strict";
import {ConversationService} from "../src/runtime/conversation-service.mjs";
import {PendingTaskStore} from "../src/runtime/pending-task-store.mjs";

class State {
  constructor(){this.data={};}
  get(key,fallback){return structuredClone(this.data[key]??fallback);}
  set(key,value){this.data[key]=structuredClone(value);}
}
const session=(chat="group",user="u1")=>JSON.stringify(["wecom",chat,user]);
function fixture(state=new State()){
 const calls={model:0,browser:0,docs:0},pendingTasks=new PendingTaskStore(state);
 const service=new ConversationService({state,pendingTasks,config:{duty:{defaultOperator:"测试甲"},runtime:{},feishuBrowser:{}},dutyConfig:{line:{team_members:["测试甲"]}},runner:{run(){calls.model++;throw Error("no model");},stop(){}},browserFiller:{enabled:true,fill(){calls.browser++;throw Error("no browser");}},draftRepository:{update(){calls.docs++;throw Error("no docs");}},docsClient:{},access:{isAuthorized:()=>true},logger:{error(){}}});
 const send=async(text,{chat="group",user="u1"}={})=>{
  const replies=[],reply=async value=>replies.push(value);
  await service.handle({id:text,platform:"wecom",chatId:chat,userId:user,chatType:chat==="private"?"single":"group",text,images:[]},{replyText:reply,replyProgress:async(_,value)=>reply(value)});
  const until=Date.now()+1000;while(service.queue.running && Date.now()<until)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(service.queue.running,false);return replies.join("\n");
 };
 return {state,pendingTasks,service,send,calls};
}

test("clear one persists cancellation, hides it and prevents fill/done/continue without online calls",async()=>{
 const f=fixture();f.pendingTasks.create({chatId:"group",userId:"u1"});f.pendingTasks.create({chatId:"group",userId:"u1"});
 f.state.set("__dutyThreadsByChat__",{[session()]:"old",[session("other")]:"keep"});
 assert.match(await f.send("/forget 1"),/已停止追踪短号1/);assert.equal(f.pendingTasks.find("1",session()).status,"cancelled");assert.equal(f.pendingTasks.list(session()).length,1);
 assert.equal(f.state.get("__dutyThreadsByChat__")[session("other")],"keep");assert.equal(f.state.get("__dutyThreadsByChat__")[session()],undefined);
 const restarted=fixture(f.state);
 assert.match(await restarted.send("/fill 1"),/不能填表/);assert.match(await restarted.send("/done 1"),/已取消/);
 assert.doesNotMatch(await restarted.send("继续"),/1 ·/);assert.equal(restarted.pendingTasks.find("2",session()).status,"ready");assert.deepEqual(restarted.calls,{model:0,browser:0,docs:0});
});

test("bulk clear previews all beyond ten, confirms across recreation and isolates user/group/private",async()=>{
 const f=fixture();for(let i=0;i<12;i++)f.pendingTasks.create({chatId:"group",userId:"u1"});
 const other=f.pendingTasks.create({chatId:"group",userId:"u2"}),group=f.pendingTasks.create({chatId:"other",userId:"u1"}),privateTask=f.pendingTasks.create({chatId:session("private"),userId:"u1"});
 f.state.set("__pendingDutyByChat__",{[session()]:{clarification:"字待确认",expiresAt:Date.now()+60000},[session("other")]:{clarification:"保留"}});
 const preview=await f.send("/forget all");assert.match(preview,/12条/);assert.match(preview,/1、2、3、4、5、6、7、8、9、10、11、12/);assert.match(preview,/未编号待补充/);assert.equal(f.pendingTasks.activeCount(session()),12);
 assert.match(await f.send("/forget confirm",{user:"u2"}),/尚未预览/);assert.match(await f.send("/forget confirm",{chat:"private"}),/尚未预览/);
 const restarted=fixture(f.state);assert.match(await restarted.send("/forget confirm"),/已停止追踪12条待办及1条待补充/);assert.equal(restarted.pendingTasks.activeCount(session()),0);
 for(const [id,key] of [[other.id,session("group","u2")],[group.id,session("other")],[privateTask.id,session("private")]])assert.equal(restarted.pendingTasks.find(id,key).status,"ready");
 assert.equal(restarted.state.get("__pendingDutyByChat__")[session()],undefined);assert.equal(restarted.state.get("__pendingDutyByChat__")[session("other")].clarification,"保留");assert.match(await restarted.send("/forget confirm"),/尚未预览/);assert.deepEqual(restarted.calls,{model:0,browser:0,docs:0});
});

test("changed or expired confirmation never clears; processing and queued work refuse; unauthorized cannot clear",async()=>{
 const f=fixture();f.pendingTasks.create({chatId:"group",userId:"u1"});
 await f.send("/forget all");f.pendingTasks.create({chatId:"group",userId:"u1"});assert.match(await f.send("/forget confirm"),/已变化/);assert.equal(f.pendingTasks.activeCount(session()),2);
 await f.send("/forget all");const confirmations=f.state.get("__forgetConfirmByChat__");confirmations[session()].expiresAt=Date.now()-1;f.state.set("__forgetConfirmByChat__",confirmations);assert.match(await f.send("/forget confirm"),/已失效/);
 f.service.queue.items.push({message:{sessionId:session()}});assert.match(await f.send("/forget 1"),/处理中或排队/);f.service.queue.items=[];
 f.pendingTasks.claim("1",session());assert.match(await f.send("/forget all"),/处理中或排队/);assert.equal(f.pendingTasks.find("2",session()).status,"ready");
 f.service.access.isAuthorized=()=>false;assert.match(await f.send("/forget 2"),/无权限/);assert.equal(f.pendingTasks.find("2",session()).status,"ready");assert.deepEqual(f.calls,{model:0,browser:0,docs:0});
});

test("single clear cannot see other members, and unnumbered clarification can be cleared without resetting identity",async()=>{
 const f=fixture();f.pendingTasks.create({chatId:"group",userId:"u2"});assert.match(await f.send("/forget 1"),/没有这个短号/);
 f.state.set("__operatorByChat__",{[session()]:"测试甲"});f.state.set("__pendingDutyByChat__",{[session()]:{userText:"工单",expiresAt:Date.now()+60000}});
 await f.send("/forget all");assert.match(await f.send("/forget confirm"),/0条待办及1条待补充/);assert.equal(f.state.get("__operatorByChat__")[session()],"测试甲");assert.match(await f.send("继续"),/没有未完成/);
});

test("old clear cards cannot confirm or dismiss a newer snapshot",async()=>{
 const f=fixture();f.pendingTasks.create({chatId:"group",userId:"u1"});await f.send("/forget all");const old=f.state.get("__forgetConfirmByChat__")[session()].digest;
 f.pendingTasks.create({chatId:"group",userId:"u1"});await f.send("/forget all");const current=f.state.get("__forgetConfirmByChat__")[session()].digest;assert.notEqual(old,current);
 assert.match(await f.send('/forget confirm '+old),/清单已失效/);assert.match(await f.send('/forget dismiss '+old),/已失效/);assert.equal(f.state.get("__forgetConfirmByChat__")[session()].digest,current);assert.equal(f.pendingTasks.activeCount(session()),2);
 assert.match(await f.send('/forget dismiss '+current),/已保留待办/);assert.equal(f.pendingTasks.activeCount(session()),2);assert.match(await f.send('/forget confirm '+current),/已失效/);
 await f.send("/forget all");assert.match(await f.send('/forget confirm '+current),/已停止追踪2条/);assert.deepEqual(f.calls,{model:0,browser:0,docs:0});
});
