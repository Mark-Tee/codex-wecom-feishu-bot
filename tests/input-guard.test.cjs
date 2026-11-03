const test=require("node:test"),assert=require("node:assert/strict");
const {parseInbound,validateFrame,createIngressGuard,MAX_FRAME}=require("../lib/input-guard.cjs");
const frame=(id="m",body={})=>({cmd:"aibot_msg_callback",headers:{req_id:"r"},body:{msgid:id,chattype:"group",chatid:"group",from:{userid:"owner"},msgtype:"text",text:{content:"今天"},...body}});
test("bounded parsing rejects poisoning, oversized and malformed JSON without throwing",()=>{
 for(const raw of ['{"__proto__":{"polluted":true}}','{"body":{"constructor":{}}}','{"prototype":1}','{"cmd":{"toString":null}}',"[","x".repeat(MAX_FRAME+1)])assert.equal(parseInbound(raw),null);
 assert.equal({}.polluted,undefined);assert.equal(parseInbound('{"text":"a\u000bb"}').text,"a\u000bb");
});
test("schema rejects invalid types, paths, mixed floods and command-size abuse",()=>{
 assert.equal(validateFrame(frame()),"");
 for(const value of [null,[],{...frame(),headers:{}},frame("x",{from:{userid:{}}}),frame("x",{text:{content:{}}}),frame("x",{text:{content:"x".repeat(16385)}}),frame("x",{msgtype:"mixed",mixed:{msg_item:[null]}}),frame("x",{msgtype:"mixed",mixed:{msg_item:Array(13).fill({msgtype:"text",text:{content:"a"}})}})])assert(validateFrame(value));
});
test("authorization and bounded admission happen before media work; burst/replay do not dispatch",()=>{
 let at=100000,downloads=0;const guard=createIngressGuard({authorized:user=>user==="owner",now:()=>at});
 const unauthorized=guard.check(frame("a",{from:{userid:"stranger"},msgtype:"image",image:{url:"https://127.0.0.1"}}));if(unauthorized.ok)downloads++;assert.equal(downloads,0);assert.equal(unauthorized.code,"unauthorized");
 const first=guard.check(frame("one"));assert(first.ok);first.release();assert.equal(guard.check(frame("one")).code,"duplicate");
 for(let i=0;i<19;i++){const admitted=guard.check(frame("loop"+i));assert(admitted.ok);admitted.release();}
 assert.equal(guard.check(frame("over")).code,"rate_limited");at+=60001;const resumed=guard.check(frame("new"));assert(resumed.ok);resumed.release();resumed.release();
 const media=[];for(let i=0;i<2;i++)media.push(guard.check(frame("image"+i,{msgtype:"image",image:{url:"https://example.com/image"}})));assert(media.every(item=>item.ok));assert.equal(guard.check(frame("image3",{msgtype:"image",image:{url:"https://example.com/image"}})).code,"busy");for(const item of media)item.release();
});
