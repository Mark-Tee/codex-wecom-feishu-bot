import test from "node:test";
import assert from "node:assert/strict";
import {leaveCandidateRange,classifyLeaveCandidate} from "../src/core/leave-policy.mjs";
import {readLeaveCandidates,readLeaveCheck} from "../src/providers/tencent-docs/leave-check.mjs";
import {parseCsv,toCsv} from "../src/core/draft-merge.mjs";
import {buildDutyContext} from "../src/providers/tencent-docs/duty-context.mjs";

function fixture() {
 const headers=["日期","动力白班值班人员","动力夜班值班人员","甲","乙","丙","丁","辅值","网络1","网络2","网络3"],rows=[headers],styles=[];
 for(let d=1;d<=30;d++){
  if(d===9)continue;
  if(d===3)rows.push(Array(headers.length).fill(""));
  const row=[`202611${String(d).padStart(2,"0")}`,"甲",d===3?"丁":"乙", "白班",d===3?"调休":"夜班","白班",d===3?"夜班":d===4?"调休":d===5?"":d===11?"休息":"白班","",d===6?"2丁":"",d===7?"1丁":"",""];
  const add=()=>{const index=rows.length;rows.push([...row]);styles.push({row:index,col:0,background_color:"FFFFFFFF"});for(const name of ["甲","乙","丙","丁"]){const col=headers.indexOf(name);styles.push({row:index,col,background_color:name===(d===2?"丁":"甲")&&d!==10?"FFFFFF00":name===(d===3?"丁":"乙")?"FFB4C6E7":"FFFFFFFF"});}};
  add();if(d===8)add();
 }
 let reads=0;
 const client={getSheetInfo:async()=>{reads++;return {sheets:[{sheet_name:"202611",sheet_id:"test",row_count:rows.length,col_count:headers.length}]};},getCsv:async()=>{reads++;return {csv_data:toCsv(rows)};},getStyles:async()=>{reads++;return {cells:structuredClone(styles)};}};
 const config={sources:{mode:"online",online:{schedule:{}}},schedule:{sheet_format:"YYYYMM",primary_white_value:"白班",primary_night_value:"夜班",primary_white_fill:"FFFF00",primary_night_fill:"B4C6E7"},site_rules:{enabled:true,home_site:"本站",offsite_site:"外站",departments:[{name:"网络",members:["甲","乙","丙","丁"],auxiliary_header:"辅值",offsite_headers:["网络1","网络2","网络3"],offsite_role:"告警值班"}]}};
 return {client,config,reads:()=>reads};
}
test("month range defaults to remaining days, explicit month covers all, leap/year boundaries validated",()=>{
 const at=new Date("2026-11-30T10:00:00+08:00");assert.equal(leaveCandidateRange("本月",at).dates.length,1);assert.equal(leaveCandidateRange("2026-11",at).dates.length,30);
 assert.equal(leaveCandidateRange("2024-02",at).dates.length,29);assert.equal(leaveCandidateRange("2026-02",at).dates.length,28);
 assert.equal(leaveCandidateRange("下月",new Date("2026-12-31T22:00:00+08:00")).month,"2027-01");
 for(const value of ["2026-00","2026-13","2026-1","其他人"])assert.throws(()=>leaveCandidateRange(value,at));
});
test("CSV empty-row preservation is opt-in and keeps quoted cell newlines",()=>{
 const rows=[["日期","班次"],["20261101","白班"],["",""],["20261103","夜班\n说明"]];
 assert.deepEqual(parseCsv(toCsv(rows),{preserveEmptyRows:true}),rows);assert.equal(parseCsv(toCsv(rows)).length,3);
});
test("one month uses five reads, isolates individual bad days and preserves physical color rows",async()=>{
 const f=fixture(),result=await readLeaveCandidates({...f,at:new Date("2026-11-03T09:00:00+08:00"),viewer:"丁",month:"2026-11"});
 assert.equal(f.reads(),5);assert.equal(result.entries.length,30);assert.deepEqual(result.counts,{candidate:21,rest:3,restricted:3,pending:3});
 const kind=d=>result.entries.find(e=>e.date===`202611${String(d).padStart(2,"0")}`).kind;
 for(const d of [2,3,6])assert.equal(kind(d),"restricted");for(const d of [4,5,11])assert.equal(kind(d),"rest");for(const d of [8,9,10])assert.equal(kind(d),"pending");assert.equal(kind(7),"candidate");
 assert.match(result.text,/可考虑的工作日：21天/);assert.match(result.text,/不代表已批准/);assert.match(result.text,/过去日期仅作排班回看/);assert.equal(Object.values(result.counts).reduce((a,b)=>a+b),30);
});
test("invalid month is rejected before network and missing published month is never replaced by old data",async()=>{
 const f=fixture();await assert.rejects(readLeaveCandidates({...f,at:new Date(),viewer:"丁",month:"2026-13"}),/月份/);assert.equal(f.reads(),0);
 await assert.rejects(readLeaveCandidates({...f,at:new Date(),viewer:"丁",month:"2026-12"}),/尚未找到/);assert.equal(f.reads(),1);
});
test("candidate classification requires explicit white duty and never counts existing rest",()=>{
 const day={date:"20261104",warnings:[],power:{white:[],night:[]},groups:[{white:[],offsite:[]}],people:[{name:"甲",shiftKind:"",offsite:true,leave:false}]};
 assert.equal(classifyLeaveCandidate(day,"甲","外站").kind,"pending");day.people[0].shiftKind="white";assert.equal(classifyLeaveCandidate(day,"甲","外站").kind,"candidate");day.people[0].leave=true;assert.equal(classifyLeaveCandidate(day,"甲","外站").kind,"rest");
});

test("daily leave reply recognizes blank rest and gives the matching next step",async()=>{
 const f=fixture(),text=await readLeaveCheck({...f,at:new Date("2026-11-03T09:00:00+08:00"),viewer:"丁",date:"2026-11-05"});
 assert.match(text,/休息（原表空白，按排班规则）/);assert.match(text,/不需要把它作为新的请假或调休日期/);assert.doesNotMatch(text,/结果：待核对/);assert.equal(f.reads(),5);
});

test("the same blank-row color mapping is preserved in ordinary work-order roster context",async()=>{
 const f=fixture(),schedule=f.config.sources.online.schedule,weekly={kind:"weekly"},handover={kind:"handover"};
 const config={...f.config,operator_name:"丁",sources:{mode:"online",online:{schedule,weekly,handover}},weekly:{sheet_format:"M月"},handover:{sheet_format:"YYYYMM"},line:{name:"网络",team_members:["甲","乙","丙","丁"],aux_column_header:"辅值"},defaults:{}};
 const client={getStyles:f.client.getStyles,getSheetInfo:file=>file===schedule?f.client.getSheetInfo():Promise.resolve({sheets:[{sheet_name:file===weekly?"11月":"202611",sheet_id:file.kind,row_count:2,col_count:17}]}),getCsv:(file,...args)=>file===schedule?f.client.getCsv(file,...args):Promise.resolve({csv_data:toCsv([Array(file===weekly?17:9).fill("表头")])})};
 const context=await buildDutyContext({client,config,operator:"丁",prompt:"预计进入时间：2026-11-03 09:00",receivedAt:"2026-11-03T09:05:00+08:00"});
 assert.equal(context.schedule.find(day=>day.date==="20261103").role.role,"night_primary");
});
