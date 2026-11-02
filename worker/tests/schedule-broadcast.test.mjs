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
test("personal first, preferred site then department, no mutation or cross-user leak",()=>{
 const system={name:"测试系统",white:["系统甲"],night:["系统乙"],auxiliary:[],standby:[],offsite:[{name:"系统丙",slot:"学习1"}],offsiteRole:"测试"};
 const network={name:"测试网络",white:["网络甲"],night:["网络乙"],auxiliary:[],standby:["网络丁"],offsite:[{name:"网络丙",slot:"异地1"}],offsiteRole:"告警"};
 const snapshot={home:"HOME_SITE",offsite:"OFFSITE_SITE",fetchedAt:"2026-11-02T01:00:00Z",days:[{date:"20261102",label:"今天",groups:[system,network],power:{white:["系统甲"],night:["网络乙"]},warnings:[],people:[{name:"网络甲",department:"测试网络",roles:["白班主值"],site:"HOME_SITE"},{name:"网络丙",department:"测试网络",roles:["白班·告警"],site:"OFFSITE_SITE"},{name:"网络休",department:"测试网络",roles:["调休"],site:"",leave:true}]}]};
 const home=formatScheduleBroadcast(snapshot,{viewer:"网络甲"});assert.ok(home.indexOf("你的排班")<home.indexOf("HOME SITE · "));assert.ok(home.indexOf("HOME SITE · 测试网络")<home.indexOf("HOME SITE · 测试系统"));assert.ok(home.indexOf("HOME SITE · ")<home.indexOf("OFFSITE SITE · "));
 const away=formatScheduleBroadcast(snapshot,{viewer:"网络丙"});assert.ok(away.indexOf("OFFSITE SITE · ")<away.indexOf("HOME SITE · "));assert.ok(away.indexOf("OFFSITE SITE · 测试网络")<away.indexOf("OFFSITE SITE · 测试系统"));
 const rest=formatScheduleBroadcast(snapshot,{viewer:"网络休"});assert.match(rest,/今天：调休\n/);assert.doesNotMatch(rest,/今天：调休｜HOME_SITE/);
 const all=formatScheduleBroadcast(snapshot);assert.doesNotMatch(all,/你的排班/);assert.ok(all.indexOf("HOME SITE · 测试系统")<all.indexOf("HOME SITE · 测试网络"));assert.equal(snapshot.days[0].groups[0],system);
});
test("personal role preserves dual power/main roles and does not turn blank into standby",()=>{
 const f=fixture();const day=summarizeSchedule(f);assert.deepEqual(day.people.find(p=>p.name==="甲").roles,["白班主值","动力白班"]);
 f.rows[1][6]="";const blank=summarizeSchedule(f).people.find(p=>p.name==="丁");assert.equal(blank.site,"");assert.match(blank.roles[0],/原表空白/);
 f.rows[1][6]="调休";const rest=summarizeSchedule(f).people.find(p=>p.name==="丁");assert.equal(rest.leave,true);assert.deepEqual(rest.roles,["调休"]);
 f.rows[1][6]="白班";f.rows[1][8]="2丁";const away=summarizeSchedule(f).people.find(p=>p.name==="丁");assert.equal(away.site,"OFFSITE_SITE");assert.match(away.roles[0],/学习/);
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

test("single date selection formats tomorrow as tomorrow, not today",async()=>{
 const f=fixture("20261103");const client={getSheetInfo:async()=>({sheets:[{sheet_name:"202611",sheet_id:"test",row_count:2,col_count:9}]}),getCsv:async()=>({csv_data:f.rows.map(r=>r.join(",")).join("\n")}),getStyles:async()=>({cells:f.styles})};
 const snapshot=await readScheduleBroadcast({client,config,at:new Date("2026-11-02T09:00:00Z"),offsets:[1]});assert.deepEqual(snapshot.days.map(d=>d.date),["20261103"]);assert.match(formatScheduleBroadcast(snapshot),/【次日排班】/);assert.match(formatScheduleBroadcast(snapshot),/明天 11\/03/);
});

test("phone layout uses short role lines, merges same-shift power and never invents vacant department posts",()=>{
 const day=summarizeSchedule(fixture());day.groups[0].standby=["待命甲甲","待命乙乙","待命丙丙","待命丁丁"];
 const text=formatScheduleBroadcast({days:[day],fetchedAt:"2026-11-02T01:00:00Z",home:"HOME_SITE",offsite:"OFFSITE_SITE"},{viewer:"甲"});
 assert.match(text,/白班主值：甲（兼动力）/);assert.match(text,/夜班主值：乙（兼动力）/);
 assert.doesNotMatch(text,/白班主值[^\n]*夜班主值/);assert.doesNotMatch(text,/动力[^\n]*未安排/);
 assert.match(text,/\n\n\*\*HOME SITE · 测试部门\*\*\n/);assert.match(text,/待命（续）：/);
 const nameLines=text.split("\n").filter(line=>line.startsWith("待命：")||line.startsWith("待命（续）："));assert.ok(nameLines.length>1);
});
