import test from "node:test";
import assert from "node:assert/strict";
import {browserOutcome,failureCategory} from "../src/runtime/observation.mjs";
test("ACK, field checks and pending readbacks cannot become verified registration",()=>{
 const good={ok:true,submitted:true,verification:{ok:true},diagnostics:{stage:"complete"}};
 assert.equal(browserOutcome(good,{entryMode:"record"}),"registration_verified");
 for(const [result,config] of [[good,{entryMode:"form"}],[{...good,requiresReadback:true},{entryMode:"record"}],[{...good,diagnostics:{stage:"submit"}},{entryMode:"record"}],[{...good,ok:false},{entryMode:"record"}]])assert.equal(browserOutcome(result,config),"submission_unverified");
 assert.equal(browserOutcome({awaitingWriteApproval:true},{entryMode:"record"}),"write_review");assert.equal(browserOutcome({ok:true},{entryMode:"record"}),"browser_incomplete");
 assert.equal(failureCategory(Error("private-name timeout")),"timeout");assert.equal(failureCategory({code:"ERR_MODULE_NOT_FOUND",message:"private-file"}),"module_missing");
});
