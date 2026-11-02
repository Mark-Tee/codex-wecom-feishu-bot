import {loadConfig} from "../src/config.mjs";
import {ConversationService} from "../src/runtime/conversation-service.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {assertSameWriteTarget,writeTaskFingerprint,claimWriteApproval,assertEmptyNewRecord} from "../src/platforms/feishu-browser/write-approval.mjs";
import {FeishuBrowserFormFiller} from "../src/platforms/feishu-browser/form-filler.mjs";
import {EdgeFormSession} from "../src/platforms/feishu-browser/edge-session.mjs";
import {formatBrowserFillSummary} from "../src/runtime/output-format.mjs";
const url="https://example.feishu.cn/base/exampleBase?table=exampleTable&view=exampleView";
const task={chatId:"test-chat",userId:"test-user",operator:"测试甲",receivedAt:"2026-11-02T10:00:00+08:00",workflowMode:"manual-feishu",fillCard:{transactionNo:"SJSW20261026000123",roomTicketNo:"JF20261026000123",expectedEnterAt:"2026-10-26 10:00",specificWork:"测试"}};
function fixture(run){const root=fs.mkdtempSync(path.join(os.tmpdir(),"approval-test-"));const file=path.join(root,"permit.json"),config={enabled:true,entryMode:"record",formUrl:url,fieldIds:{taskList:"example"},writeApprovalFile:file};const write=(patch={})=>fs.writeFileSync(file,JSON.stringify({version:1,operation:"create-one",fingerprint:writeTaskFingerprint(task),targetUrl:url,expiresAt:Date.now()+60000,...patch}));return Promise.resolve().then(()=>run({root,file,config,write})).finally(()=>fs.rmSync(root,{recursive:true,force:true}));}
test("write target is bound to origin, base and table, not display name or view",()=>{
 assert.doesNotThrow(()=>assertSameWriteTarget(url,url+"&theme=dark"));
 for(const value of [url.replace("exampleTable","anotherTable"),url.replace("exampleBase","anotherBase"),url.replace("example.feishu.cn","evil.example")])assert.throws(()=>assertSameWriteTarget(value,url));
 assert.throws(()=>assertSameWriteTarget("about:blank",url));
});
test("approval binds full task, sender, original date and business fields",()=>{
 for(const changed of [{...task,userId:"other"},{...task,chatId:"other"},{...task,fillCard:{...task.fillCard,expectedEnterAt:"2026-11-02 10:00"}},{...task,fillCard:{...task.fillCard,transactionNo:"SJSW20261026000456"}}])assert.notEqual(writeTaskFingerprint(changed),writeTaskFingerprint(task));
 assert.equal(writeTaskFingerprint({...task,fillCard:{...task.fillCard}}),writeTaskFingerprint(task));
});
test("absent, malformed, expired and mismatched approvals fail closed",()=>fixture(({config,write,file})=>{
 assert.throws(()=>claimWriteApproval(config,task),/共享表测试保护/);
 fs.writeFileSync(file,"invalid");assert.throws(()=>claimWriteApproval(config,task));
 for(const patch of [{expiresAt:0},{operation:"update"},{fingerprint:"other"},{targetUrl:url.replace("exampleTable","other")}]){write(patch);assert.throws(()=>claimWriteApproval(config,task));assert.equal(fs.existsSync(file+".used"),false);}
}));
test("permit survives process restart as consumed, uncertain attempt cannot retry",()=>fixture(({config,write,file})=>{
 write();const receipt=claimWriteApproval(config,task);receipt.mark("submit-started");
 assert.throws(()=>claimWriteApproval(config,task),/禁止重复建单/);
 assert.match(fs.readFileSync(file+".used","utf8"),/submit-started/);
 assert.doesNotMatch(fs.readFileSync(file+".used","utf8"),/SJSW|测试甲/);
}));
test("missing approval prevents even opening the browser or touching the table",()=>fixture(async({config})=>{
 let opens=0;const original=EdgeFormSession.open;EdgeFormSession.open=async()=>{opens++;throw Error("must not open");};
 try{const result=await new FeishuBrowserFormFiller({config}).fill(task);assert.equal(opens,0);assert.equal(result.submitted,false);assert.equal(result.requiresLocalReview,true);assert.match(result.message,/共享表测试保护/);assert.doesNotMatch(formatBrowserFillSummary(result),/手工提交，也可/);}finally{EdgeFormSession.open=original;}
}));
test("only empty fresh form values accepted, normal mode unchanged",()=>{
 assert.doesNotThrow(()=>assertEmptyNewRecord([""," ","\u200B"," \uFEFF"]));assert.throws(()=>assertEmptyNewRecord(["\u200BSJSW-existing"]));assert.throws(()=>assertEmptyNewRecord(["","someone else's record"]));
 assert.throws(()=>assertEmptyNewRecord(null));assert.equal(claimWriteApproval({},task),null);
});

test("configuration preserves approval gate through normalization",()=>fixture(({file,root})=>{
 const configFile=path.join(root,"config.json");fs.writeFileSync(configFile,JSON.stringify({platform:{type:"wecom"},runtime:{workdir:"."},duty:{configPath:"duty.json",defaultOperator:"tester"},feishuBrowser:{enabled:false,writeApprovalFile:file}}));
 assert.equal(loadConfig(configFile).feishuBrowser.writeApprovalFile,file);
}));
test("test mode rejects Tencent completion before any write or queue action",async()=>{
 const replies=[];const service=new ConversationService({config:{feishuBrowser:{writeApprovalFile:"local-permit"}},dutyConfig:{},state:{get:()=>[],set(){throw Error("must not mutate");}},access:{isAuthorized(){throw Error("must not reach");}}});
 await service.handle({text:"/done 1"},{replyText:async text=>replies.push(text)});assert.match(replies[0],/腾讯草稿暂不写入/);assert.equal(service.queue.size,0);
});

test("shared-table success banner is not presented as verified final acceptance",()=>{
 const text=formatBrowserFillSummary({configured:true,submitted:true,requiresReadback:true,taskNumber:"WN20261026001"});assert.match(text,/尚待本机读回/);assert.doesNotMatch(text,/已自动核对并提交/);
});
