import {spawn} from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {gzipSync} from "node:zlib";
import {orderIdentifiers,sameBusinessOrder,readOrderSnapshot,assertNoExistingOrder,reserveOrderAttempt,explicitDuplicateTest} from "../src/platforms/feishu-browser/order-guard.mjs";
import {FeishuBrowserFormFiller} from "../src/platforms/feishu-browser/form-filler.mjs";
const url="https://example.feishu.cn/base/exampleBase?table=tableExample";
const card={transactionNo:"SJSW20261102000123",roomTicketNo:"JF20261102000456",expectedEnterAt:"2026-11-02 10:00",specificWork:"测试事项"};
const task={chatId:"chat-example",userId:"user-example",operator:"测试甲",receivedAt:"2026-11-02T10:01:00+08:00",workflowMode:"manual-feishu",fillCard:card};
const ids={transactionNo:"fldTransactionExample",roomTicketNo:"fldRoomExample",taskList:"fldTaskExample"};
test("snapshot carries actual saved date for the matching business order", () => fixture(async ({config}) => {
 config.fieldIds = {...ids, expectedEnterAt: "fldDateExample"};
 const record = {...row(), fldDateExample: {value: 1793656800000}};
 const snapshot = await readOrderSnapshot(server([{recordMap: {recordExample: record}, tableRecordNum: 1}]), config, card);
 assert.equal(snapshot.matchedRecords[0].expectedEnterAt, 1793656800000);
 assert.equal(snapshot.matchedRecords[0].taskNumber, "WD20261102001");
}));
function fixture(run){const root=fs.mkdtempSync(path.join(os.tmpdir(),"order-guard-test-"));const config={enabled:true,entryMode:"record",orderDeduplication:true,formUrl:url,fieldIds:ids,taskListViewId:"viewExample",orderLedgerDir:root,diagnostics:{enabled:false}};return Promise.resolve().then(()=>run({root,config})).finally(()=>fs.rmSync(root,{recursive:true,force:true}));}
function row(order=card,no="WD20261102001"){return {[ids.transactionNo]:{value:[{text:order.transactionNo||""}]},[ids.roomTicketNo]:{value:[{text:order.roomTicketNo||""}]},[ids.taskList]:{value:[{text:no}]}};}
function server(pages){
 let calls=0,mutations=0;
 return {
  get calls(){return calls},get mutations(){return mutations},close(){},
  async evaluate(expression){
   if(expression==="location.href")return url;
   if(!expression.startsWith("/* READ_ONLY_ORDER_SNAPSHOT */")){mutations++;throw Error("Unexpected UI action");}
   const page=pages[Math.min(calls++,pages.length-1)];if(page instanceof Error)throw page;
   const fetch=async(endpoint,options)=>{
    assert.equal(new URL(endpoint).origin,new URL(url).origin);assert.equal(options.body,undefined);assert.equal(options.method,undefined);
    return {ok:true,json:async()=>({code:0,data:{records:gzipSync(JSON.stringify(page)).toString("base64")}})};
   };
   return vm.runInNewContext(expression,{URL,Uint8Array,atob,Response,Blob,DecompressionStream,fetch},{timeout:1000});
  },
 };
}
test("business identity follows confirmed pair rule, missing-one uses known identifier",()=>{
 const x=orderIdentifiers(card);assert.equal(sameBusinessOrder(x,x),true);
 assert.equal(sameBusinessOrder(x,{...x,roomTicketNo:"another"}),false);
 assert.equal(sameBusinessOrder(x,{...x,transactionNo:"another"}),false);
 assert.equal(sameBusinessOrder(x,{transactionNo:x.transactionNo,roomTicketNo:""}),true);
 assert.equal(sameBusinessOrder(x,{transactionNo:"",roomTicketNo:x.roomTicketNo}),true);
 assert.equal(sameBusinessOrder({transactionNo:"",roomTicketNo:""},x),false);
 assert.deepEqual(orderIdentifiers({transactionNo:" \u200Bsjsw123 ",roomTicketNo:" jf456 "}),{transactionNo:"SJSW123",roomTicketNo:"JF456"});
});
test("read-only snapshot detects duplicate without leaking other fields",()=>fixture(async({config})=>{
 const s=server([{recordMap:{recordExample:row()},tableRecordNum:1}]);const result=await readOrderSnapshot(s,config,card,"WD20261102");assert.equal(result.complete,true);assert.equal(result.loaded,1);assert.deepEqual(result.matches,["WD20261102001"]);assert.equal(s.mutations,0);assert.throws(()=>assertNoExistingOrder(result),/相同业务工单/);
}));
test("same transaction with different room is allowed by pair rule",()=>fixture(async({config})=>{
 const s=server([{recordMap:{recordExample:row({...card,roomTicketNo:"JF20261102000789"})},tableRecordNum:1}]);const result=await readOrderSnapshot(s,config,card,"WD");assert.equal(result.matches.length,0);assert.doesNotThrow(()=>assertNoExistingOrder(result));
}));

test("pagination must finish whole table, and shares task-number scan",()=>fixture(async({config})=>{
 const s=server([{recordMap:{a:row({...card,roomTicketNo:"x"},"WD20261102001")},tableRecordNum:2},{recordMap:{b:row({...card,roomTicketNo:"y"},"WD20261102002")},tableRecordNum:2}]);const result=await readOrderSnapshot(s,config,card,"WD");assert.equal(s.calls,2);assert.equal(result.loaded,2);assert.equal(result.numbers.length,2);
}));
test("failed, partial, repeated, wrong-field and changing snapshots fail closed",()=>fixture(async({config})=>{
 const fixtures=[
  [new Error("network")],
  [{recordMap:{a:row()},tableRecordNum:2},{recordMap:{},tableRecordNum:2}],
  [{recordMap:{a:row()},tableRecordNum:2},{recordMap:{a:row()},tableRecordNum:2}],
  [{recordMap:{a:row()},tableRecordNum:2},{recordMap:{b:row()},tableRecordNum:3}],
  [{recordMap:{a:{}},tableRecordNum:1}],
  [{recordMap:{},tableRecordNum:null}],
 ];
 for(const pages of fixtures)await assert.rejects(()=>readOrderSnapshot(server(pages),config,card,"WD"));
}));
test("local lease rejects concurrent execution before any cloud access",()=>fixture(({config})=>{
 const lease=reserveOrderAttempt(config,task);assert.throws(()=>reserveOrderAttempt(config,task),/禁止并发/);lease.finish();
}));
test("same pending may retry before create, changed request cannot reuse it",()=>fixture(({config})=>{
 reserveOrderAttempt(config,task).finish();const lease=reserveOrderAttempt(config,task);lease.finish();assert.throws(()=>reserveOrderAttempt(config,{...task,receivedAt:"2026-11-02T11:00:00+08:00"}),/禁止重复/);
}));
test("unknown submit result persists across restart and blocks retry",()=>fixture(({config,root})=>{
 const lease=reserveOrderAttempt(config,task);lease.mark("create-started");lease.mark("submit-started");lease.finish();assert.throws(()=>reserveOrderAttempt(config,task),/禁止重复/);
 const text=fs.readFileSync(path.join(root,fs.readdirSync(root).find(name=>name.endsWith('.json'))),'utf8');assert.match(text,/unknown-requires-review/);assert.doesNotMatch(text,/SJSW|JF2026|测试甲/);
}));
test("submitted attempt is not recreated on repeated message",()=>fixture(({config})=>{
 const lease=reserveOrderAttempt(config,task);lease.mark("submitted-awaiting-readback");lease.finish();assert.throws(()=>reserveOrderAttempt(config,{...task,chatId:"other-chat"}),/禁止重复/);
}));
test("different room remains a separate order, incomplete order matches existing known number",()=>fixture(({config})=>{
 const first=reserveOrderAttempt(config,task);first.mark("submitted-awaiting-readback");first.finish();reserveOrderAttempt(config,{...task,fillCard:{...card,roomTicketNo:"JF20261102000789"}}).finish();assert.throws(()=>reserveOrderAttempt(config,{...task,fillCard:{...card,roomTicketNo:""}}),/禁止重复/);
}));
test("corrupt ledger is not overwritten or ignored",()=>fixture(({config,root})=>{
 reserveOrderAttempt(config,task).finish();const file=path.join(root,fs.readdirSync(root).find(name=>name.endsWith('.json')));fs.writeFileSync(file,"broken");assert.throws(()=>reserveOrderAttempt(config,task),/审计不可用/);assert.equal(fs.readFileSync(file,"utf8"),"broken");
}));
test("historical duplicate test requires explicit local permission, test mode and marker",()=>{
 const t={...task,workflowMode:"feishu-test",fillCard:{...card,specificWork:"【测试勿统计】测试"}};assert.equal(explicitDuplicateTest({allowExistingOrder:true},t),true);assert.equal(explicitDuplicateTest({},t),false);assert.equal(explicitDuplicateTest({allowExistingOrder:true},task),false);assert.equal(explicitDuplicateTest({allowExistingOrder:true},{...t,fillCard:card}),false);
});
test("filler blocks duplicate before Add Record, field editing or submit",()=>fixture(async({config})=>{
 const session=server([{recordMap:{recordExample:row()},tableRecordNum:1}]);const result=await new FeishuBrowserFormFiller({config,sessionFactory:async()=>session}).fill(task);assert.equal(session.mutations,0);assert.equal(result.submitted,false);assert.equal(result.requiresLocalReview,true);assert.match(result.message,/相同业务工单/);
}));
test("filler blocks wrong table before even scanning or touching it",()=>fixture(async({config})=>{
 let evaluated=0;const session={evaluate:async expression=>{evaluated++;assert.equal(expression,"location.href");return url.replace('tableExample','otherTable')},close(){}};const result=await new FeishuBrowserFormFiller({config,sessionFactory:async()=>session}).fill(task);assert.equal(evaluated,1);assert.equal(result.submitted,false);assert.match(result.message,/不是获准/);
}));

test("separate Node processes cannot reserve the same order twice",()=>fixture(async({root,config})=>{
 const file=path.join(root,"process-input.json");fs.writeFileSync(file,JSON.stringify({config,task}));
 const moduleUrl=new URL("../src/platforms/feishu-browser/order-guard.mjs",import.meta.url).href;
 const code=`import fs from 'node:fs';import {reserveOrderAttempt} from ${JSON.stringify(moduleUrl)};const {config,task}=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));try{const lease=reserveOrderAttempt(config,task);await new Promise(r=>setTimeout(r,100));lease.mark('submit-started');lease.finish();process.stdout.write('reserved');}catch{process.stdout.write('blocked');}`;
 const run=()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,["--input-type=module","-e",code,file],{windowsHide:true});let out="";child.stdout.on('data',chunk=>out+=chunk);child.on('error',reject);child.on('close',exit=>exit?reject(Error('child failed')):resolve(out));});
 const outcomes=await Promise.all([run(),run()]);assert.deepEqual(outcomes.sort(),['blocked','reserved']);
}));
