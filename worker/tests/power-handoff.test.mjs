import test from "node:test";
import assert from "node:assert/strict";
import {powerHandoffSlot,powerHandoffPeople,formatPowerHandoff} from "../src/core/power-handoff.mjs";
import {readHandoffRecords} from "../src/platforms/feishu-browser/handoff-reader.mjs";
import {summarizeSchedule} from "../src/providers/tencent-docs/schedule-broadcast.mjs";
const day=date=>({date,warnings:[],power:{white:["测试甲"],night:["测试乙"]},groups:[{white:["测试丙"],night:["测试乙","测试丁"],auxiliary:["测试戊"],standby:["测试己"]}]});
const settings={locationValue:"home",siteName:"南区",categoryRules:[{workContentValue:"wiring",category:"布线理线"},{workContentValue:"rack",descriptionPattern:"上架",category:"设备上架"}]};
const at=new Date("2026-11-04T08:30:00Z");
const row=(id,patch={})=>({id,number:"WD20261104001",location:"home",workContent:"wiring",description:"布线",transactionNo:"SJSW20261104000001",roomTicketNo:"JF20261104000001",...patch});
test("night handoff crosses month: owner is previous night, recipients display new white shift",()=>{
 const slot=powerHandoffSlot(new Date("2026-11-30T23:30:00Z"));assert.equal(slot.shiftDate,"20261130");assert.equal(slot.handoverDate,"20261201");assert.equal(slot.prefix,"WN20261130");
 const people=powerHandoffPeople(slot,{days:[day("20261130"),day("20261201")]});assert.equal(people.owner,"测试乙");assert.equal(people.nextPower,"测试甲");assert.deepEqual(people.onSite,["测试丙","测试戊","测试己"]);
 const incoming={...day("20261201"),people:[{name:"测试己"},{name:"测试丙"},{name:"测试戊"}]};assert.deepEqual(powerHandoffPeople(slot,{days:[day("20261130"),incoming]}).onSite,["测试己","测试丙","测试戊"]);
 assert.equal(powerHandoffSlot(new Date("2026-11-04T08:35:00Z")),null);
 assert.throws(()=>powerHandoffPeople(slot,{days:[]}),/缺失/);
});

test("holiday onsite list includes explicit white shifts without inventing auxiliary roles",()=>{
 const config={schedule:{primary_white_value:"白班",primary_night_value:"夜班",primary_white_fill:"FFFF00",primary_night_fill:"B4C6E7"},site_rules:{enabled:true,home_site:"home",offsite_site:"away",departments:[{name:"测试部门",members:["甲","乙","丙","丁"],auxiliary_header:"辅值",offsite_headers:["异地1"],offsite_role:"学习"}]}};
 const rows=[["日期","动力白班值班人员","动力夜班值班人员","甲","乙","丙","丁","辅值","异地1"],["20261001","甲","乙","白班","夜班","白班","白班","",""]];
 const styles=[{row:1,col:0,background_color:"FF92D050"},{row:1,col:3,background_color:"FFFFFF00"},{row:1,col:4,background_color:"FFB4C6E7"}];
 const incoming=summarizeSchedule({config,rows,styles,date:"20261001"}),slot=powerHandoffSlot(new Date("2026-09-30T23:30:00Z"));
 const previous={...incoming,date:"20260930"};
 assert.deepEqual(powerHandoffPeople(slot,{days:[previous,incoming]}).onSite,["丙","丁"]);
 assert.equal(incoming.groups[0].auxiliary,null);
 rows[1][8]="2丁";const offsite=summarizeSchedule({config,rows,styles,date:"20261001"});
 assert.deepEqual(powerHandoffPeople(slot,{days:[previous,offsite]}).onSite,["丙"]);
});
test("statistics exclude other site, other shift and marked tests, and deduplicate business orders",()=>{
 const slot=powerHandoffSlot(at),people=powerHandoffPeople(slot,{days:[day("20261104")]});
 const records=[row("one"),row("duplicate"),row("other-entry",{roomTicketNo:"JF20261104000002"}),row("other-site",{location:"away"}),row("test",{description:"【测试勿统计】布线"}),row("night",{number:"WN20261104001"}),row("unknown",{number:"WD20261104003",workContent:"unknown",transactionNo:"",roomTicketNo:""}),row("rack",{number:"WD20261104004",workContent:"rack",description:"上架设备插线",transactionNo:"",roomTicketNo:""})];
 const result=formatPowerHandoff({slot,people,records,settings,generatedAt:at});assert.equal(result.total,4);assert.equal(result.duplicates,1);assert.equal(result.excludedTests,1);assert.deepEqual(result.categories,{布线理线:2,待核对分类:1,设备上架:1});
 assert.deepEqual(people.onSite,["测试丁"]);assert.match(result.text,/模拟草稿/);assert.match(result.text,/不代表实际已完成/);assert.match(result.text,/待核对任务：WD20261104003/);assert.match(result.text,/17点30分/);
});
test("ambiguous category rules never silently choose a label",()=>{
 const result=formatPowerHandoff({slot:powerHandoffSlot(at),people:{onSite:[],nextPower:"测试乙",nextKind:"night"},records:[row("one")],settings:{...settings,categoryRules:[...settings.categoryRules,{workContentValue:"wiring",category:"其他"}]},generatedAt:at});assert.deepEqual(result.categories,{待核对分类:1});
});

test("partial identifiers do not merge two distinct full pairs; conflicting duplicates need review",()=>{
 const input={slot:powerHandoffSlot(at),people:{onSite:[],nextPower:"测试乙",nextKind:"night"},settings,generatedAt:at};
 const result=formatPowerHandoff({...input,records:[row("partial",{roomTicketNo:""}),row("one"),row("two",{roomTicketNo:"JF20261104000002"})]});assert.equal(result.total,2);assert.equal(result.duplicates,1);
 const conflict=formatPowerHandoff({...input,records:[row("one"),row("duplicate",{workContent:"rack",description:"上架设备"})]});assert.equal(conflict.total,1);assert.deepEqual(conflict.categories,{待核对分类:1});
});
test("read-only source requires complete stable unique pagination and closes its connection",async()=>{
 const config={debugPort:1,formUrl:"https://example.feishu.cn/base/example?table=exampleTable",taskListViewId:"exampleView",fieldIds:Object.fromEntries(["taskList","location","workContent","specificWork","transactionNo","roomTicketNo"].map(k=>[k,k]))};
 for(const pages of [[{recordIds:["one"],total:1,selected:[row("one")]}],[{recordIds:["one"],total:2,selected:[]},{recordIds:["one"],total:2,selected:[]}],[{recordIds:["one"],total:2,selected:[]},{recordIds:["two"],total:3,selected:[]}],[{recordIds:[],total:1,selected:[]}]]){
  let closed=false,calls=0;const session={evaluate:async expression=>{if(expression==="location.href")return config.formUrl;assert.match(expression,/READ_ONLY_HANDOFF/);assert.doesNotMatch(expression,/\.click\(|location.assign|method:\s*['"](?:POST|PUT|DELETE)/);return {...pages[calls++],fieldsPresent:Object.fromEntries(Object.keys(config.fieldIds).map(k=>[k,true]))};},close(){closed=true;}};
  if(pages[0].total===1&&pages[0].recordIds.length)assert.equal((await readHandoffRecords(config,"WD20261104",{connect:async()=>session})).length,1);
  else await assert.rejects(readHandoffRecords(config,"WD20261104",{connect:async()=>session}),/重复|变化|不完整/);
  assert.equal(closed,true);
 }
 let reads=0;await assert.rejects(readHandoffRecords(config,"WD",{connect:async()=>({evaluate:async()=>{reads++;return config.formUrl.replace('exampleTable','wrongTable');},close(){}})}),/目标/);assert.equal(reads,1);
 await assert.rejects(readHandoffRecords(config,"WD",{connect:async()=>({evaluate:async expression=>expression==="location.href"?config.formUrl:{recordIds:["one"],total:1,selected:[],fieldsPresent:{}},close(){}})}),/字段映射/);
});
