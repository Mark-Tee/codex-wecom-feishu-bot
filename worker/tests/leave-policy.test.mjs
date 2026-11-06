import test from "node:test";
import assert from "node:assert/strict";
import {checkRosterLeave,leaveCheckSummary,leaveCheckDate} from "../src/core/leave-policy.mjs";
import {readLeaveCheck} from "../src/providers/tencent-docs/leave-check.mjs";
const day=(patch={})=>({date:"20261104",warnings:[],power:{white:[],night:[]},people:[{name:"测试甲",shiftKind:"white",leave:false,offsite:false}],groups:[{name:"测试部门",white:[],night:[],offsite:[]}],...patch});
test("night, power night, both departments primary and offsite network1 prohibit leave",()=>{
 for(const d of [day({people:[{name:"测试甲",shiftKind:"night"}]}),day({power:{white:[],night:["测试甲"]}}),day({groups:[{name:"系统",white:["测试甲"],offsite:[]}]}),day({groups:[{name:"网络",white:["测试甲"],offsite:[]}]}),day({groups:[{name:"网络",night:["测试甲"],white:[],offsite:[]}]}),day({groups:[{name:"网络",white:[],offsite:[{name:"测试甲",slot:"网络1"}]}]})]){
  const result=checkRosterLeave(d,"测试甲","外站");assert.equal(result.restricted,true);assert.match(leaveCheckSummary(result),/不能请假或调休/);
 }
});
test("power white alone, auxiliary, standby and network2/3 do not imply approval",()=>{
 for(const slot of ["","网络2","网络3","数据中心1"]){const d=day({power:{white:["测试甲"],night:[]},groups:[{name:"网络",white:[],auxiliary:["测试甲"],standby:["测试甲"],offsite:slot?[{name:"测试甲",slot}]:[]}]});const result=checkRosterLeave(d,"测试甲","外站");assert.equal(result.restricted,false);assert.equal(result.uncertain,false);assert.match(leaveCheckSummary(result),/不代表请假已批准/);}
});
test("blank or warned roster cannot turn uncertainty into leave approval",()=>{
 assert.equal(checkRosterLeave(day({people:[{name:"测试甲",shiftKind:"",leave:false,offsite:false}]}),"测试甲").uncertain,true);
 const warned=checkRosterLeave(day({warnings:["岗位待核对"]}),"测试甲");assert.equal(warned.uncertain,true);assert.match(leaveCheckSummary(warned),/待核对/);
 assert.throws(()=>checkRosterLeave(day(),"其他人"),/找不到/);
});
test("date validation uses Shanghai date, crosses year and refuses impossible dates before network",async()=>{
 const at=new Date("2026-12-31T23:00:00+08:00");assert.deepEqual(leaveCheckDate("明天",at),{date:"2027-01-01",offset:1});assert.equal(leaveCheckDate("今天",at).date,"2026-12-31");
 for(const value of ["2026-02-29","2026-11-31","2026-13-01","2026-1-1","昨天","测试甲"]){assert.throws(()=>leaveCheckDate(value,at));let reads=0;await assert.rejects(readLeaveCheck({client:{getSheetInfo:async()=>{reads++;}},config:{},at,viewer:"测试甲",date:value}));assert.equal(reads,0);}
});
