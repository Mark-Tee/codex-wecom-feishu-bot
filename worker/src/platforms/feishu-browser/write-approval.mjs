import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parseBitableTarget } from "./task-list-reader.mjs";

export function assertSameWriteTarget(actualUrl, expectedUrl) {
  const actual=parseBitableTarget(actualUrl), expected=parseBitableTarget(expectedUrl);
  if(actual.origin!==expected.origin || actual.appToken!==expected.appToken || actual.tableId!==expected.tableId)
    {const error=new Error("飞书写入已拦截：当前页面不是获准的目标表");error.requiresLocalReview=true;throw error;}
}
export function writeTaskFingerprint(task) {
  function stable(value) {
    if(Array.isArray(value))return value.map(stable);
    if(value && typeof value==="object")return Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]));
    return value;
  }
  return crypto.createHash("sha256").update(JSON.stringify(stable({
    fillCard:task.fillCard,chatId:task.chatId,userId:task.userId,operator:task.operator,
    receivedAt:task.receivedAt,workflowMode:task.workflowMode,
  }))).digest("hex");
}
export function claimWriteApproval(config, task, now=Date.now()) {
  if(!config.writeApprovalFile)return null;
  const file=config.writeApprovalFile;
  if(!path.isAbsolute(file) || config.entryMode!=="record")
    throw new Error("飞书写入已拦截：一次性许可配置无效");
  let approval;
  try {
    if(fs.statSync(file).size>8192)throw Error("oversize");
    approval=JSON.parse(fs.readFileSync(file,"utf8").replace(/^\uFEFF/,""));
  } catch {
    throw new Error("飞书尚未写入：已进入共享表测试保护，需维护者在本机核准此单后再 /fill");
  }
  if(approval.operation!=="create-one" || approval.version!==1 || approval.expiresAt<=now || !Number.isFinite(approval.expiresAt)
    || approval.fingerprint!==writeTaskFingerprint(task) || !task.fillCard?.expectedEnterAt)
    throw new Error("飞书尚未写入：一次性许可未覆盖此工单、日期已变或许可已过期，请在本机核验");
  assertSameWriteTarget(config.formUrl,approval.targetUrl);
  const used=file+".used";
  try {
    fs.writeFileSync(used,JSON.stringify({stage:"reserved",at:new Date(now).toISOString(),fingerprint:approval.fingerprint})+"\n",{flag:"wx",mode:0o600});
  } catch {
    throw new Error("飞书写入已拦截：许可已使用或无法锁定；请先只读核对结果，禁止重复建单");
  }
  return {allowExistingOrder:approval.allowExistingOrder===true,mark(stage){fs.appendFileSync(used,JSON.stringify({stage,at:new Date().toISOString()})+"\n");}};
}
export function assertEmptyNewRecord(values) {
  if(!Array.isArray(values) || values.some(value=>String(value||"").replace(/[\u200B-\u200D\u2060\uFEFF]/gu,"").trim()))
    throw new Error("飞书写入已拦截：新记录关键字段不是全空，禁止复用已有记录");
}
