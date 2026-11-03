const test=require("node:test"),assert=require("node:assert/strict");
const {dutyErrorReply}=require("../lib/duty-error.cjs");
test("worker failures expose a short reference without paths or stack",()=>{
 for(const detail of ["ERR_MODULE_NOT_FOUND Cannot find module D:/private/secret.mjs at node:internal", "timeout D:/private/input"]){const result=dutyErrorReply(new Error(detail),"case-123");assert.match(result,/case-123/);assert.doesNotMatch(result,/D:|node:|ERR_MODULE|secret/);assert(result.length<180);assert.match(result,/勿重复/);}
});
