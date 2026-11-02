import {orderIdentifiers,sameBusinessOrder} from "../../core/order-identity.mjs";
export {orderIdentifiers,sameBusinessOrder} from "../../core/order-identity.mjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {parseBitableTarget} from "./task-list-reader.mjs";
import {writeTaskFingerprint} from "./write-approval.mjs";
const digest=value=>crypto.createHash("sha256").update(String(value)).digest("hex");
function review(message){const error=new Error(message);error.requiresLocalReview=true;return error;}
export function explicitDuplicateTest(approval,task) {
 return Boolean(approval?.allowExistingOrder && task.workflowMode==="feishu-test" && String(task.fillCard?.specificWork||"").startsWith("【测试勿统计】"));
}
export async function readOrderSnapshot(session,config,card,prefix="") {
 const {origin,appToken,tableId}=parseBitableTarget(config.formUrl),ids=config.fieldIds||{},order=orderIdentifiers(card);
 if(!ids.transactionNo||!ids.roomTicketNo||!ids.taskList||!config.taskListViewId||(!order.transactionNo&&!order.roomTicketNo))throw review("飞书查重配置或业务单号不完整，未允许建单");
 const seen=new Set(),numbers=new Set(),matches=[];let expectedTotal=null,offset=0;const verifiedFields={transactionNo:false,roomTicketNo:false,taskList:false};
 for(let page=0;page<20;page++){
  let data;
  try{data=await session.evaluate(`/* READ_ONLY_ORDER_SNAPSHOT */ (async()=>{
   const url=new URL(${JSON.stringify(`/space/api/v1/bitable/${appToken}/records`)},${JSON.stringify(origin)});
   for(const [key,value] of Object.entries({tableId:${JSON.stringify(tableId)},tableID:${JSON.stringify(tableId)},viewId:${JSON.stringify(config.taskListViewId)},viewID:${JSON.stringify(config.taskListViewId)},viewLazyLoad:'true',offset:${JSON.stringify(String(offset))},limit:'3000',removeFmlExtra:'true'}))url.searchParams.set(key,value);
   const response=await fetch(url,{credentials:'include',headers:{accept:'application/json'}});const payload=await response.json();
   if(!response.ok||payload.code!==0||!payload.data?.records)throw Error('无法完整读取飞书主表');
   const bytes=Uint8Array.from(atob(payload.data.records),c=>c.charCodeAt(0));
   const decoded=JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
   const clean=(${orderIdentifiers.toString()}),same=(${sameBusinessOrder.toString()});
   const plain=v=>v==null?'':Array.isArray(v)?v.map(plain).join(''):typeof v==='object'?plain(v.text??v.value??''):String(v);
   const records=Object.entries(decoded.recordMap||{}),ids=${JSON.stringify(ids)},wanted=${JSON.stringify(order)};
   const numbers=[],matches=[];const fieldsPresent={transactionNo:false,roomTicketNo:false,taskList:false};
   for(const [id,row] of records){
    for(const key of Object.keys(fieldsPresent))if(Object.hasOwn(row,ids[key]))fieldsPresent[key]=true;
    const value=plain(row[ids.taskList]?.value).trim();if(value.startsWith(${JSON.stringify(prefix)}))numbers.push(value);
    if(same(clean({transactionNo:plain(row[ids.transactionNo]?.value),roomTicketNo:plain(row[ids.roomTicketNo]?.value)}),wanted))matches.push(value||'(无任务号)');
   }
   return {recordIds:records.map(([id])=>id),total:decoded.tableRecordNum==null||decoded.tableRecordNum===""?null:Number(decoded.tableRecordNum),numbers,matches,fieldsPresent};
  })()`);}catch{throw review("飞书业务查重读取失败，未允许建单；请稍后在原待办核验");}
  if(!Array.isArray(data?.recordIds)||!Number.isSafeInteger(data.total)||data.total<0)throw review("飞书查重未返回完整记录总数，停止建单");
  if(expectedTotal===null)expectedTotal=data.total;else if(expectedTotal!==data.total)throw review("查重期间主表记录数变化，请重新核验，未允许提交");
  for(const id of data.recordIds){if(seen.has(id))throw review("飞书查重分页重复，不能确认完整性");seen.add(id);}
  for(const value of data.numbers||[])numbers.add(value);matches.push(...data.matches||[]);offset+=data.recordIds.length;
  for(const key of Object.keys(verifiedFields))verifiedFields[key] ||= Boolean(data.fieldsPresent?.[key]);
  if(seen.size===expectedTotal){
   if(expectedTotal&&!Object.values(verifiedFields).every(Boolean))throw review("飞书单号或任务号字段映射未核实，停止建单");
   return {numbers:[...numbers],matches,loaded:seen.size,complete:true};
  }
  if(!data.recordIds.length||seen.size>expectedTotal)throw review("飞书查重分页不完整，停止建单");
 }
 throw review("飞书记录过多，未完成全部业务查重，停止建单");
}
export function assertNoExistingOrder(snapshot,allowDuplicateTest=false) {
 if(!snapshot?.complete)throw review("飞书业务查重不完整，停止建单");
 if(snapshot.matches.length&&!allowDuplicateTest)throw review(`相同业务工单已在飞书存在，未新增。请核对原任务：${snapshot.matches.slice(0,3).join('、')}`);
}
export function reserveOrderAttempt(config,task,allowDuplicateTest=false) {
 if(!path.isAbsolute(config.orderLedgerDir||""))throw review("缺少本机业务查重状态目录，停止建单");
 const target=parseBitableTarget(config.formUrl),order=orderIdentifiers(task.fillCard);
 if(!order.transactionNo&&!order.roomTicketNo)throw review("缺少可核验的业务单号，停止建单");
 fs.mkdirSync(config.orderLedgerDir,{recursive:true});
 const file=path.join(config.orderLedgerDir,digest(JSON.stringify(target))+".json"),lock=file+".writer.tmp",attempt=crypto.randomUUID();
 let locked=false;
 try{fs.writeFileSync(lock,attempt,{flag:"wx",mode:0o600});locked=true;}catch{throw review("本机已有建单执行或待核验的中断，请先核验，禁止并发建单");}
 const release=()=>{if(locked&&fs.readFileSync(lock,"utf8")===attempt){fs.unlinkSync(lock);locked=false;}};
 try{
  let data={version:1,orders:{}};
  if(fs.existsSync(file)){if(fs.statSync(file).size>32*1024*1024)throw Error('ledger-too-large');data=JSON.parse(fs.readFileSync(file,"utf8"));if(data.version!==1||!data.orders||typeof data.orders!=="object")throw Error('invalid-ledger');}
  const ids={transactionNo:order.transactionNo?digest(order.transactionNo):"",roomTicketNo:order.roomTicketNo?digest(order.roomTicketNo):""},fingerprint=writeTaskFingerprint(task);
  const previous=Object.values(data.orders).find(entry=>sameBusinessOrder(entry.ids,ids)&&(!allowDuplicateTest||entry.fingerprint===fingerprint));
  if(previous && !(previous.status==="safe-before-create"&&previous.fingerprint===fingerprint))throw review("本机已有同单号待办或提交尝试，请先只读核验，禁止重复建单");
  const key=allowDuplicateTest?digest(JSON.stringify(ids)+fingerprint):digest(JSON.stringify(ids));
  const save=()=>{const temp=file+"."+attempt+".tmp";fs.writeFileSync(temp,JSON.stringify(data),{mode:0o600});fs.renameSync(temp,file);};
  let phase="reserved";
  data.orders[key]={ids,fingerprint,attempt,status:phase,updatedAt:new Date().toISOString()};save();
  return {
   mark(stage){phase=stage;data.orders[key].status=stage;data.orders[key].updatedAt=new Date().toISOString();save();},
   finish(){
    if(phase==="reserved"){data.orders[key].status="safe-before-create";save();}
    else if(phase==="create-started"||phase==="submit-started"){data.orders[key].status="unknown-requires-review";save();}
    release();
   },
  };
 }catch(error){release();if(error.requiresLocalReview)throw error;throw review("本机查重审计不可用，停止建单，不绕过保护");}
}
