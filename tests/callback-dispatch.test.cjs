const test=require("node:test"),assert=require("node:assert/strict");
const {WeComLongConnection}=require("../lib/wecom-long-connection.cjs");
test("malformed transport data and throwing handlers are isolated at the connection boundary",async()=>{
 class Socket{constructor(){this.readyState=1;this.handlers={};}addEventListener(name,fn){(this.handlers[name]||=[]).push(fn);}send(){}close(){}emit(raw){for(const fn of this.handlers.message||[])fn({data:raw});}}
 const logs=[];const connection=new WeComLongConnection({WebSocketImpl:Socket,url:"ws://test.invalid",botId:"test",secret:"test",log:message=>logs.push(message),parseFrame:JSON.parse,onFrame:()=>{throw Error("untrusted failure");}});
 connection.connect();try{assert.doesNotThrow(()=>connection.socket.emit("{"));assert.doesNotThrow(()=>connection.socket.emit('{"cmd":"unknown"}'));await new Promise(resolve=>setImmediate(resolve));assert(logs.some(line=>line.includes("解析失败")));assert(logs.some(line=>line.includes("已隔离")));}finally{connection.stop();}
});
test("a callback sharing a reply request ID is dispatched, never consumed as its ACK",async()=>{
 class Socket{constructor(){this.readyState=1;this.handlers={};}addEventListener(name,fn){(this.handlers[name]||=[]).push(fn);}send(){}close(){}emit(frame){for(const fn of this.handlers.message||[])fn({data:JSON.stringify(frame)});}}
 const received=[],connection=new WeComLongConnection({WebSocketImpl:Socket,url:"ws://test.invalid",botId:"test",secret:"test",onFrame:frame=>received.push(frame),parseFrame:JSON.parse});connection.connect();
 let pending;try{pending=connection.waitAck("shared",1000);const event={cmd:"aibot_event_callback",headers:{req_id:"shared"},body:{msgtype:"event",event:{eventtype:"template_card_event"}}};connection.socket.emit(event);assert.equal(received.length,1);assert.equal(connection.ackWaiters.has("shared"),true);connection.socket.emit({headers:{req_id:"shared"},errcode:0});await pending;}finally{if(connection.ackWaiters.has("shared"))connection.socket.emit({headers:{req_id:"shared"},errcode:0});await pending?.catch(()=>{});connection.stop();}
});
