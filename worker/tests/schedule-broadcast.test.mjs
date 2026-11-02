import test from "node:test";
import assert from "node:assert/strict";
import {summarizeSchedule, readScheduleBroadcast, formatScheduleBroadcast} from "../src/providers/tencent-docs/schedule-broadcast.mjs";
import {auxiliaryPolicy} from "../src/core/auxiliary-policy.mjs";
import {classifyRole} from "../src/core/duty-role.mjs";
const config={sources:{mode:"online",online:{schedule:{}}},schedule:{sheet_format:"YYYYMM",primary_white_value:"白班",primary_night_value:"夜班",primary_white_fill:"FFFF00",primary_night_fill:"B4C6E7"},site_rules:{enabled:true,home_site:"HOME_SITE",offsite_site:"OFFSITE_SITE",departments:[{name:"测试部门",members:["甲","乙","丙","丁"],auxiliary_header:"辅值",offsite_headers:["异地1"],offsite_role:"学习"}]}};
function fixture(date="20261102") {
 const headers=["日期","动力白班值班人员","动力夜班值班人员","甲","乙","丙","丁","辅值","异地1"];
 return {rows:[headers,[date,"甲","乙","白班","夜班","白班","白班","丙",""]],styles:[{row:1,col:0,background_color:"FFFFFFFF"},{row:1,col:3,background_color:"FFFFFF00"},{row:1,col:4,background_color:"FFB4C6E7"},{row:1,col:5,background_color:"FFFFFFFF"},{row:1,col:6,background_color:"FFFFFFFF"}],date,config};
}
test("summary roles, overlapping power primary, standby and numeric prefix",()=>{
 const f=fixture();f.rows[1][7]="2丙";const day=summarizeSchedule(f);
 assert.deepEqual(day.groups[0].auxiliary,["丙"]);assert.deepEqual(day.groups[0].standby,["丁"]);
 const text=formatScheduleBroadcast({days:[day,day],fetchedAt:"2026-11-02T00:20:00Z",home:"HOME_SITE",offsite:"OFFSITE_SITE"});assert.match(text,/白班辅值：丙/);assert.match(text,/在线表读取/);
});
test("weekends including makeup, holidays, and nights have no auxiliary",()=>{
 for(const date of ["20261107","20261108"]) {assert.equal(auxiliaryPolicy({date}).allowed,false);assert.equal(summarizeSchedule(fixture(date)).groups[0].auxiliary,null);}
 assert.equal(auxiliaryPolicy({date:"20261102",holiday:true}).allowed,false);
 for(const minutes of [509,1050]) assert.equal(auxiliaryPolicy({date:"20261102",minutes}).allowed,false);
 assert.equal(auxiliaryPolicy({date:"20261102",minutes:510}).allowed,true);
});
test("work-order classification blocks auxiliary outside eligible shifts",()=>{
 for (const [date,minutes] of [["20261107",600],["20261102",1050]]) {
  const f=fixture(date);const role=classifyRole({row:f.rows[1],headers:f.rows[0],styles:f.styles,config:{...config,operator_name:"丙"},minutes});
  assert.equal(role.role,"ambiguous");assert.equal(role.requiresClarification,true);
 }
});
test("missing rows, columns, unknown names and main colors stop publishing",()=>{
 for(const mutate of [f=>f.rows.pop(),f=>f.rows.push(f.rows[1]),f=>f.rows[0][2]="missing",f=>f.rows[1][1]="外人",f=>f.styles.pop()&&f.styles.splice(1,1)]) {const f=fixture();mutate(f);assert.throws(()=>summarizeSchedule(f));}
});
test("month and year rollover reads both sheets freshly, never cache fallback",async()=>{
 const calls=[];const client={getSheetInfo:async()=>({sheets:["202612","202701"].map(sheet_name=>({sheet_name,sheet_id:sheet_name,row_count:2,col_count:9}))}),getCsv:async(_,sheet)=>{calls.push(sheet);const f=fixture(sheet==="202612"?"20261231":"20270101");return {csv_data:f.rows.map(r=>r.join(",")).join("\n")};},getStyles:async()=>({cells:fixture().styles})};
 const result=await readScheduleBroadcast({client,config,at:new Date("2026-12-31T00:20:00Z")});assert.deepEqual(result.days.map(d=>d.date),["20261231","20270101"]);assert.equal(calls.length,4);
 client.getCsv=async()=>{throw Error("offline");};await assert.rejects(()=>readScheduleBroadcast({client,config}));
});
test("decorative footer color changes do not block, role color changes do",async()=>{
 let count=0,changeRole=false;
 const f=fixture();f.rows.push([...f.rows[1]]);f.rows[2][0]="20261103";
 const client={getSheetInfo:async()=>({sheets:[{sheet_name:"202611",sheet_id:"test",row_count:4,col_count:9}]}),getCsv:async()=>({csv_data:f.rows.map(r=>r.join(",")).join("\n")}),getStyles:async()=>{count++;const cells=[...f.styles,...f.styles.map(c=>({...c,row:2})),{row:3,col:0,background_color:String(count)}].map(c=>({...c}));if(changeRole&&count%2===0)cells[1].background_color="FFFFFFFF";return {cells};}};
 await readScheduleBroadcast({client,config,at:new Date("2026-11-02T00:20:00Z")});
 changeRole=true;await assert.rejects(()=>readScheduleBroadcast({client,config,at:new Date("2026-11-02T00:20:00Z")}),/岗位颜色变化/);
});
