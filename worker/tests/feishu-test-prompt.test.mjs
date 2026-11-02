import test from "node:test";
import assert from "node:assert/strict";
import {buildFeishuTestPrompt} from "../src/core/feishu-test-prompt.mjs";
test("test extraction receives enum vocabulary and original-date rule, not secrets",()=>{
 const text=buildFeishuTestPrompt({message:{receivedAt:"2026-11-02T10:00:00+08:00",images:[]},browserConfig:{defaults:{source:"事务工单"},options:{source:["事务工单"],location:["测试机房"],workContent:["故障维修、隐患整改"]},secret:"ExampleSecretPlaceholder",profileDir:"private-profile"}});
 assert.match(text,/默认来源：事务工单/);assert.match(text,/不是申请处室或申请人/);assert.match(text,/不替换成今天/);assert.match(text,/不作为本环节的前置依赖/);assert.doesNotMatch(text,/ExampleSecretPlaceholder|private-profile/);
});
