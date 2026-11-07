import fs from 'node:fs/promises';
import path from 'node:path';
import {Workbook,SpreadsheetFile,FileBlob} from '@oai/artifact-tool';
import {assignmentFormula,activeCountFormula} from '../lib/roster-leave-formulas.cjs';

const [input,output]=process.argv.slice(2);
const data=JSON.parse(await fs.readFile(input,'utf8'));
const {month,headers,result,check}=data;
// Measured 202611 widths in pixels; keep the established monthly-table layout.
const columnWidths=[80,58,59,60,67,60,58,60,60,60,58,58,60,60,60,58,58,96,66,58,68,73,72,120,65,68,65,65,65];
const col=n=>{let s='';while(n){s=String.fromCharCode(65+(n-1)%26)+s;n=Math.floor((n-1)/26);}return s;};
const book=Workbook.create(),sheet=book.worksheets.add(month.replace('-',''));
const matrix=[headers];
for(const day of result.days){
  const row=Array(headers.length).fill('');row[0]=Number(day.date.replaceAll('-',''));
  for(const [person,role] of Object.entries(day.roles))row[headers.indexOf(person)]=role==='night'?'夜班':role==='rest'?'':'白班';
  row[18]='星期'+'日一二三四五六'[new Date(day.date+'T00:00:00Z').getUTCDay()];
  for(const group of data.input.groups){
    row[headers.indexOf(group.auxiliary_header)]=group.members.filter(p=>day.roles[p]==='aux').join('、');
    group.offsite_headers.forEach((header,i)=>row[headers.indexOf(header)]=group.members.filter(p=>day.roles[p]==='off'+(i+1)).join('、'));
  }
  row[27]=day.powerWhite;row[28]=day.powerNight;matrix.push(row);
}
const end=matrix.length;
sheet.getRange(`A1:AC${end}`).values=matrix;
const full=sheet.getRange(`A1:AC${end}`);
full.format.font={name:'等线',size:12};full.format.horizontalAlignment='center';full.format.verticalAlignment='center';full.format.rowHeightPx=24;
full.format.borders={preset:'all',style:'thin',color:'#000000'};
full.format.fill='#FFFFFF';
sheet.getRange(`V2:X${end}`).format.fill='#00B0F0';
sheet.getRange(`Y2:Y${end}`).format.fill='#FFE270';
sheet.getRange(`AC2:AC${end}`).format.fill='#FFE9E8';
columnWidths.forEach((width,c)=>sheet.getRange(`${col(c+1)}:${col(c+1)}`).format.columnWidthPx=width);
sheet.getRange(`T1:AC${end}`).format.wrapText=true;
sheet.getRange('A1:AC1').format.fill='#00B0F0';sheet.getRange('A1:AC1').format.rowHeightPx=56;sheet.getRange('A1:AC1').format.wrapText=true;
for(const style of data.templateStyles){
  const cell=sheet.getRange(col(style.col+1)+'1');
  if(style.background_color?.length===8&&!style.background_color.startsWith('00'))cell.format.fill='#'+style.background_color.slice(-6);
}
for(let d=0;d<result.days.length;d++){
  const day=result.days[d],r=d+2;
  for(let c=19;c<29;c++){
    const people=String(matrix[d+1][c]).split('、').filter(Boolean);
    const formula=assignmentFormula(headers,people,r);
    if(formula)sheet.getRange(`${col(c+1)}${r}`).formulas=[[formula]];
  }
  const lines=Math.max(1,...matrix[d+1].slice(19).map((v,i)=>Math.ceil(String(v).length/Math.max(1,Math.floor((columnWidths[i+19]-8)/16)))));
  sheet.getRange(`A${r}:AC${r}`).format.rowHeightPx=Math.max(24,lines*16+4);
  if(!day.workday)sheet.getRange(`A${r}:U${r}`).format.fill='#92D050';
  for(const [person,role] of Object.entries(day.roles)){
    const c=col(headers.indexOf(person)+1);
    if(role==='main')sheet.getRange(`${c}${r}`).format.fill='#FFFF00';
    if(role==='night')sheet.getRange(`${c}${r}`).format.fill='#B4C6E7';
  }
  sheet.getRange(`Q${r}`).formulas=[[`=COUNTIF(B${r}:P${r},"白班")`]];
  sheet.getRange(`R${r}`).formulas=[[`=COUNTIF(B${r}:P${r},"夜班")`]];
}
sheet.getRange(`B2:P${end}`).conditionalFormats.add('expression',{formula:'=B2="调休"',format:{fill:'#FF0000'}});
const labels=['白班总数','夜班总数','总班时','本月应达工时','超额工时','白班主值次数','白班辅值次数','滨湖次数','滨湖1号位','滨湖2号位','滨湖3号位','动力白班','动力夜班'];
labels.forEach((label,i)=>{
  const r=end+2+i;sheet.getRange(`A${r}`).values=[[label]];
  for(let c=1;c<=15;c++){
    const letter=col(c+1),person=headers[c];
    const roleSets={5:['main'],6:['aux'],7:['off1','off2','off3'],8:['off1'],9:['off2'],10:['off3']};
    const included=result.days.flatMap((day,index)=>(i===11?day.powerWhite===person:i===12?day.powerNight===person:roleSets[i]?.includes(day.roles[person]))?[index+2]:[]);
    const formula=i===0?`=COUNTIF(${letter}2:${letter}${end},"白班")`:i===1?`=COUNTIF(${letter}2:${letter}${end},"夜班")`:i===2?`=${letter}${end+2}+2*${letter}${end+3}`:i===4?`=${letter}${end+4}-${letter}${end+5}`:i>=5?activeCountFormula(headers,person,included):null;
    const cell=sheet.getRange(`${letter}${r}`);if(formula)cell.formulas=[[formula]];else cell.values=[[check.target]];
  }
});
sheet.getRange(`A${end+2}:P${end+14}`).format.borders={preset:'all',style:'thin',color:'#000000'};
sheet.getRange(`A${end+2}:P${end+2}`).format.fill='#FFFF00';
sheet.getRange(`A${end+3}:P${end+3}`).format.fill='#93CDDD';
sheet.getRange(`A${end+4}:P${end+4}`).format.fill='#FF0000';
sheet.getRange(`A${end+2}:A${end+14}`).format.wrapText=true;
sheet.getRange(`A${end+2}:P${end+14}`).format.rowHeightPx=36;
sheet.getRange(`A${end+16}:AC${end+16}`).merge();sheet.getRange(`A${end+16}`).values=[['操作：在本人当天B:P班次格填写“调休”，岗位姓名与次数自动扣除；多人岗位只移除本人，不补人。改回原班次则恢复；不要覆盖T:AC公式。']];
sheet.getRange(`A${end+17}:AC${end+17}`).merge();sheet.getRange(`A${end+17}`).values=[[`来源：${data.source}；承接${data.sourceSheet}；获取于${data.retrievedAt}；未修改在线主表。`]];
sheet.getRange(`A${end+18}:AC${end+18}`).merge();sheet.getRange(`A${end+18}`).values=[[`工时=白班1、夜班2；最低${check.target}；工作日不额外排休，超额由人工调整。${result.optimal?'当前目标最优':'可行解，公平性未证明最优'}。官方日历：https://www.beijing.gov.cn/fuwu/bmfw/sy/jrts/202511/t20251104_4258838.html`]];
sheet.getRange(`A${end+19}:AC${end+19}`).merge();sheet.getRange(`A${end+19}`).values=[['沿用往期配色：周末/节假日休息绿，主值黄，夜班浅蓝，调休红；数据中心蓝，网络1浅黄，动力夜班浅粉。总班时统计行红色沿用旧模板，不代表异常。']];
sheet.freezePanes.freezeRows(1);sheet.freezePanes.freezeColumns(1);
book.recalculate();
const baselineStats=sheet.getRange(`B${end+2}:P${end+14}`).values;
const leaveChecks=[];
function checkLeave(dayIndex,people){
  const row=dayIndex+2,day=result.days[dayIndex];
  for(const person of people)sheet.getRange(`${col(headers.indexOf(person)+1)}${row}`).values=[['调休']];
  book.recalculate();
  for(let c=19;c<29;c++){
    const expected=String(matrix[dayIndex+1][c]).split('、').filter(name=>name&&!people.includes(name)).join('、');
    if(sheet.getRange(`${col(c+1)}${row}`).values[0][0]!==expected)throw Error('调休岗位清除或多人保留校验失败');
  }
  const actualStats=sheet.getRange(`B${end+2}:P${end+14}`).values;
  for(let c=1;c<=15;c++){
    const p=headers[c],role=day.roles[p],leave=people.includes(p)?1:0,white=role!=='rest'&&role!=='night'?1:0,night=role==='night'?1:0;
    const deltas=[white,night,white+2*night,0,white+2*night,Number(role==='main'),Number(role==='aux'),Number(role.startsWith('off')),Number(role==='off1'),Number(role==='off2'),Number(role==='off3'),Number(day.powerWhite===p),Number(day.powerNight===p)];
    for(let i=0;i<13;i++)if(actualStats[i][c-1]!==baselineStats[i][c-1]-leave*deltas[i])throw Error('调休统计或其他人员保留校验失败');
  }
  leaveChecks.push({date:day.date,people,passed:true});
  for(const person of people)sheet.getRange(`${col(headers.indexOf(person)+1)}${row}`).values=[[matrix[dayIndex+1][headers.indexOf(person)]]];
  book.recalculate();
}
for(const person of headers.slice(1,16))checkLeave(0,[person]);
for(let c=19;c<29;c++){
  const d=matrix.slice(1).findIndex(row=>String(row[c]).includes('、'));
  if(d>=0){
    const people=String(matrix[d+1][c]).split('、');
    for(const person of people)checkLeave(d,[person]);
    checkLeave(d,people);
  }
}
await fs.writeFile(path.join(path.dirname(output),'leave-linkage-check.json'),JSON.stringify(leaveChecks,null,2));
for(let c=1;c<=15;c++){
  const actual=sheet.getRange(`${col(c+1)}${end+4}`).values[0][0];
  if(actual!==check.totals[headers[c]])throw Error('Excel工时公式与独立校验不一致');
}
const errors=await book.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!',options:{useRegex:true,maxResults:20},maxChars:1500});
if(/#REF!|#DIV\/0!|#VALUE!|#NAME\?|#NUM!/.test(errors.ndjson))throw Error('公式错误扫描未通过');
await fs.writeFile(path.join(path.dirname(output),'formula-check.json'),errors.ndjson);
await (await SpreadsheetFile.exportXlsx(book)).save(output);
const reopened=await SpreadsheetFile.importXlsx(await FileBlob.load(output));
const saved=reopened.worksheets.getItem(month.replace('-',''));
if(saved.getRange(`A1:AC${end}`).values.length!==end)throw Error('导出后日期行数不符');
for(let c=1;c<=15;c++)if(saved.getRange(`${col(c+1)}${end+4}`).values[0][0]!==check.totals[headers[c]])throw Error('重新导入后工时不符');
for(let d=0;d<result.days.length;d++)for(let c=19;c<29;c++)if(String(saved.getRange(`${col(c+1)}${d+2}`).values[0][0]||'')!==String(matrix[d+1][c]))throw Error('重新导入后岗位基线不符');
const savedPerson=matrix[1].slice(19).find(v=>v)?.split('、')[0],savedCell=saved.getRange(`${col(headers.indexOf(savedPerson)+1)}2`),savedOriginal=savedCell.values[0][0];
savedCell.values=[['调休']];reopened.recalculate();
for(let c=19;c<29;c++)if(saved.getRange(`${col(c+1)}2`).values[0][0]!==String(matrix[1][c]).split('、').filter(p=>p&&p!==savedPerson).join('、'))throw Error('导出后调休联动失效');
savedCell.values=[[savedOriginal]];reopened.recalculate();
await fs.writeFile(path.join(path.dirname(output),'preview-left.png'),new Uint8Array(await (await book.render({sheetName:sheet.name,range:'A1:S12',scale:1.5})).arrayBuffer()));
await fs.writeFile(path.join(path.dirname(output),'preview-right.png'),new Uint8Array(await (await book.render({sheetName:sheet.name,range:'T1:AC12',scale:1.5})).arrayBuffer()));
await fs.writeFile(path.join(path.dirname(output),'preview-stats.png'),new Uint8Array(await (await book.render({sheetName:sheet.name,range:`A${end+2}:P${end+14}`,scale:1.5})).arrayBuffer()));
console.log(JSON.stringify({output,verified:true}));
