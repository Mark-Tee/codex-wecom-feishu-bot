import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TencentDraftRepository } from "../src/providers/tencent-docs/draft-repository.mjs";
import { mergeDraftRows, parseCsv, toCsv } from "../src/core/draft-merge.mjs";
const row=(id,person="person-A",start="09:00",end="10:00")=>[id,"site","type","same title","no","11.02","1h","","",person,"no","no",start,end,"done","","1h"];
for (const [label,incoming] of [["person",row(2,"person-B")],["time",row(2,"person-A","10:00","11:00")]]) {
 test(`same title with different ${label} keeps both work records`,()=>{const result=mergeDraftRows({weeklyExisting:[Array(17).fill("header"),row(1)],handoverExisting:[],weeklyIncoming:[incoming],handoverIncoming:[],currentDate:"20261102",previousDate:"20261101",year:"2026"});assert.equal(result.weeklyRows.length,2);});
}
async function fixture(t,{dropWrites=false,emptyStyles=false}={}) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"draft-safety-"));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const rows={w:[],h:[]};let writes=0;
 const client={async getSheetInfo(){return {sheets:[{sheet_id:"w",sheet_name:"周报草稿",row_count:20,col_count:17},{sheet_id:"h",sheet_name:"交接班草稿",row_count:20,col_count:9}]};},async getCsv(_file,id){return {csv_data:toCsv(rows[id])};},async clear(_file,id){rows[id]=[];},async setCsv(_file,id,csv){writes++;if(!dropWrites)rows[id]=parseCsv(csv);},async setStyle(){},async setBorder(){},async getStyles(_file,_id,range){const end=Number(range.match(/(\d+)$/)[1]);return {cells:emptyStyles?[]:Array.from({length:17*(end-1)},()=>({horizontal_align:"center",vertical_align:"center",borders:{top:true,bottom:true,left:true,right:true}}))};}};
 const repo=new TencentDraftRepository({client,config:{draft:{online_file_id:"fixture"}},backupDir:dir});
 return {repo,rows,get writes(){return writes;}};
}
const options={currentDate:"20261102",previousDate:"20261101",order:{transactionNo:"SYNTHETIC-ORDER-1"}};
const spec={weeklyRows:[row(1)],handoverRows:[]};
test("acknowledged but lost write cannot report completion; uncertain retry blocked",async t=>{const f=await fixture(t,{dropWrites:true});await assert.rejects(f.repo.update(spec,options),/内容核验失败/);await assert.rejects(f.repo.update(spec,options),/待本机核验/);});
test("empty style readback cannot pass validation",async t=>{const f=await fixture(t,{emptyStyles:true});await assert.rejects(f.repo.update(spec,options),/格式读回范围不完整/);});
test("same business order submitted again is a no-write duplicate",async t=>{const f=await fixture(t);await f.repo.update(spec,options);const writes=f.writes;const result=await f.repo.update({weeklyRows:[row(2,"person-B")],handoverRows:[]},options);assert.equal(result.duplicate,true);assert.equal(f.writes,writes);});
test("different business orders with same title remain separate",async t=>{const f=await fixture(t);await f.repo.update(spec,options);await f.repo.update({weeklyRows:[row(2,"person-B")],handoverRows:[]},{...options,order:{transactionNo:"SYNTHETIC-ORDER-2"}});assert.equal(f.rows.w.length,3);});
