const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {pathToFileURL}=require('node:url');

// Verified calendars are explicit: never guess holidays for a new year.
const HOLIDAYS=['2026-01-01:2026-01-03','2026-02-15:2026-02-23','2026-04-04:2026-04-06','2026-05-01:2026-05-05','2026-06-19:2026-06-21','2026-09-25:2026-09-27','2026-10-01:2026-10-07'];
const MAKEUP=new Set(['2026-01-04','2026-02-14','2026-02-28','2026-05-09','2026-09-20','2026-10-10']);
function calendar(month){
  if(!/^2026-(0[1-9]|1[0-2])$/.test(month))throw Error('开发阶段仅支持已核验的2026年月历，其他年份须先更新官方日历');
  const n=new Date(Date.UTC(2026,Number(month.slice(5)),0)).getUTCDate();
  return Array.from({length:n},(_,i)=>{const date=`${month}-${String(i+1).padStart(2,'0')}`,week=new Date(date+'T00:00:00Z').getUTCDay(),holiday=HOLIDAYS.some(r=>{const [a,b]=r.split(':');return date>=a&&date<=b;});return {date,holiday,workday:MAKEUP.has(date)||(!holiday&&week!==0&&week!==6),aux:!holiday&&week!==0&&week!==6};});
}
function assertOnlineMonthAbsent(info,month){
  calendar(month);
  if(!Array.isArray(info.sheets))throw Error('无法核验在线月表，禁止发布');
  if(info.sheets.some(sheet=>sheet.sheet_name===month.replace('-','')))throw Error(`在线已有${month}排班表，只允许生成本地Excel草稿，不替换在线表`);
}
async function createOnlineMonth(client,file,month){
  const latest=await client.getSheetInfo(file);
  assertOnlineMonthAbsent(latest,month);
  return client.callTool('add_sheet',{file_url:file.fileUrl||file.file_url,name:month.replace('-',''),append_index:true});
}
function validate(input,result){
  if(!Array.isArray(input.previousMain))throw Error('缺少上月末白班主值，无法核验跨月间隔');
  if(!Array.isArray(result.days)||result.days.length!==input.days.length)throw Error(result.reason||'生成结果不完整');
  const people=input.groups.flatMap(g=>g.members),totals=Object.fromEntries(people.map(p=>[p,0]));
  const valid=new Set(['main','aux','night','off1','off2','off3','rest']);
  for(let d=0;d<input.days.length;d++){
    const expected=input.days[d],day=result.days[d];
    if(day.date!==expected.date||Object.keys(day.roles).length!==people.length)throw Error('日期或人员不一致');
    for(const g of input.groups){
      const count=r=>g.members.filter(p=>day.roles[p]===r).length;
      if(count('main')!==1||count('night')!==1||count('aux')!==Number(expected.aux)||count('off1')>1||count('off2')>1)throw Error('主辅值、夜班或滨湖人数不符');
      if(count('off2')>count('off1')||(count('off3')&&!count('off2')))throw Error('滨湖3号位必须承接1、2号位之后的人员');
    }
    for(const p of people){
      const r=day.roles[p],previous=d?result.days[d-1].roles[p]==='night':input.previousNight.includes(p);
      const previousMain=d?result.days[d-1].roles[p]==='main':input.previousMain.includes(p);
      if(r==='main'&&previousMain)throw Error('白班主值不得连续两个自然日（含跨月）');
      if(!valid.has(r)||(!expected.workday&&r.startsWith('off'))||(previous&&r!=='rest'))throw Error('岗位、工作日或夜班后休息冲突');
      if(expected.workday&&r==='rest'&&!previous)throw Error('工作日不得自动安排额外休息，应安排南岗或滨湖');
      totals[p]+=r==='night'?2:r==='rest'?0:1;
    }
    if(day.roles[day.powerWhite]!=='main'||day.roles[day.powerNight]!=='night')throw Error('动力兼岗不符');
  }
  const target=input.days.filter(d=>d.workday).length;
  for(const p of people)if(totals[p]<target)throw Error('月度工时不达标');
  return {target,totals};
}
function run(executable,args,input,timeout=65000,tempDir){return new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{windowsHide:true,env:{...process.env,TEMP:tempDir,TMP:tempDir,PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'}});let out='',err='';
  const timer=setTimeout(()=>{child.kill();reject(Error('本地生成超时，未报告成功'));},timeout);
  child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>err+=v);child.on('error',e=>{clearTimeout(timer);reject(e);});
  child.on('close',code=>{clearTimeout(timer);code===0?resolve(out):reject(Error(`本地生成失败：${err.slice(-400)}`));});
  child.stdin.on('error',()=>{});child.stdin.end(input);
});}
async function generate({settings,business,rulesRoot,month}){
  const days=calendar(month),groups=business.site_rules.departments;
  const tempDir=path.join(path.resolve(settings.outputDir),'work');
  await fs.mkdir(tempDir,{recursive:true});
  const {TencentDocsClient}=await import(pathToFileURL(path.join(rulesRoot,'src/providers/tencent-docs/client.mjs')).href);
  const {parseCsv}=await import(pathToFileURL(path.join(rulesRoot,'src/core/draft-merge.mjs')).href);
  const {summarizeSchedule}=await import(pathToFileURL(path.join(rulesRoot,'src/providers/tencent-docs/schedule-broadcast.mjs')).href);
  const client=new TencentDocsClient(),source=business.sources.online.schedule;
  const info=await client.getSheetInfo(source);
  const onlineMonthExists=info.sheets.some(sheet=>sheet.sheet_name===month.replace('-',''));
  const previous=new Date(`${month}-01T00:00:00Z`);previous.setUTCDate(0);
  const key=previous.toISOString().slice(0,10).replaceAll('-','');
  const sheet=info.sheets.find(s=>s.sheet_name===key.slice(0,6));
  if(!sheet)throw Error('上月班表不存在，不能衔接');
  const column=n=>{let s='';while(n){s=String.fromCharCode(65+(n-1)%26)+s;n=Math.floor((n-1)/26);}return s;};
  const range=`A1:${column(sheet.col_count)}${sheet.row_count}`;
  const csv=await client.getCsv(source,sheet.sheet_id,range),styles=await client.getStyles(source,sheet.sheet_id,range);
  if(typeof csv.csv_data!=='string'||csv.not_viewable_locations?.length||styles.not_viewable_locations?.length)throw Error('上月数据或样式不完整');
  const rows=parseCsv(csv.csv_data);
  const summary=summarizeSchedule({rows,styles:styles.cells,date:key,config:business});
  const previousNight=summary.groups.flatMap(g=>g.night);
  const previousMain=summary.groups.flatMap(g=>g.white);
  const people=groups.flatMap(g=>g.members);
  if(people.length!==15||new Set(people).size!==15)throw Error('开发阶段须核对15人唯一名单');
  const input={days,groups,previousNight,previousMain};
  const result=JSON.parse(await run(settings.python,[path.join(__dirname,'../scripts/solve-roster.py')],JSON.stringify(input),65000,tempDir));
  const check=validate(input,result);
  const folder=path.join(settings.outputDir,month+'-'+new Date().toISOString().replace(/[:.]/g,'-'));
  await fs.mkdir(folder,{recursive:true});
  const payload={month,source:source.fileUrl||source.file_url,sourceSheet:sheet.sheet_name,retrievedAt:new Date().toISOString(),headers:rows[0].slice(0,29),templateStyles:styles.cells.filter(c=>c.row===0&&c.col<29),onlineMonthExists,input,result,check};
  const dataPath=path.join(folder,'roster.json');await fs.writeFile(dataPath,JSON.stringify(payload,null,2));
  const output=path.join(folder,'月度排班草稿.xlsx');
  await run(settings.node,[path.join(__dirname,'../scripts/export-roster.mjs'),dataPath,output],null,90000,tempDir);
  const stat=await fs.stat(output);if(stat.size<1000)throw Error('Excel文件未完成导出');
  return {output,check,result,onlineMonthExists};
}
function createRosterGeneration({settings,generateDraft=generate,business,rulesRoot,state={},save=()=>{}}){
  let busy=false;
  const authorized=user=>Boolean(settings?.enabled&&settings.ownerUserId&&user===settings.ownerUserId);
  const service={authorized,get busy(){return busy;},async resume(reply){
    const job=state.__rosterGeneration;
    if(!busy&&job?.status==='running'&&authorized(job.frame.body.from.userid))return service.command({...job.frame,__cardAction:true},`生成排班稿 ${job.month}`,reply);
  },async command(frame,text,reply){
    if(!/^生成排班稿(?:\s|$)/u.test(text))return false;
    if(!authorized(frame.body?.from?.userid)){await reply(frame,'生成排班稿仅开发维护者本人可用。');return true;}
    const match=text.match(/^生成排班稿(?:\s+(2026-(?:0[1-9]|1[0-2])))?$/u);
    if(!match){await reply(frame,'用法：生成排班稿 [YYYY-MM]；开发阶段仅支持2026年，默认下月。');return true;}
    if(busy){await reply(frame,'已有排班草稿正在生成，请等待结果。');return true;}
    const current=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).format(new Date());
    const at=new Date(current+'-01T00:00:00Z');at.setUTCMonth(at.getUTCMonth()+1);const month=match[1]||at.toISOString().slice(0,7);
    busy=true;
    try{
      state.__rosterGeneration={status:'running',month,frame:{body:{from:{userid:frame.body.from.userid},chattype:frame.body.chattype,chatid:frame.body.chatid}}};save(state);
      await reply(frame,`正在生成${month}排班草稿：读取上月班表、计算岗位并核验，约需一分钟。文件仅保存本地，不修改在线表。`);
      frame={...frame,__cardAction:true};
      const value=await generateDraft({settings,business:business(),rulesRoot,month});
      state.__rosterGeneration={status:'completed',month,output:value.output};save(state);
      await reply(frame,`${month}排班草稿已生成并通过岗位、休息及工时核验。\n本地文件：${value.output}\n每人最低${value.check.target}工时；实际${Math.min(...Object.values(value.check.totals))}–${Math.max(...Object.values(value.check.totals))}工时。\n${value.result.optimal?'求解已达到当前目标最优。':'已找到可行草稿，公平性尚未证明最优。'}\n${value.onlineMonthExists?"在线已有该月排班，本次仅生成Excel草稿，未替换在线表。":"本次仅生成本地草稿，未自动发布在线表。"}月底夜班须延续至下月。`);
    }
    catch(error){if(state.__rosterGeneration?.status==='completed')throw error;state.__rosterGeneration={status:'failed',month};save(state);await reply(frame,`未生成可交付班表：${error.message}\n未修改在线主表。`);}finally{busy=false;}
    return true;
  }};return service;
}
module.exports={calendar,validate,generate,createRosterGeneration,assertOnlineMonthAbsent,createOnlineMonth};
