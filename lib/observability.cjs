const fs=require("node:fs"),path=require("node:path");
const {appendRotatingLog}=require("./rotating-log.cjs");
const {normalizeRosterCommand}=require("./roster-command.cjs");
const {remoteDenial}=require("./remote-policy.cjs");
const OUTCOMES=new Set(["handler_returned","worker_returned","denied","clarification","source_conflict","recognition_invalid","identifiers_invalid","write_review","browser_incomplete","registration_verified","submission_unverified","draft_returned","failed"]);
const ERRORS=new Set(["module_missing","timeout","connection","platform_rejected","source_unavailable","runtime"]);
const CATEGORIES=new Set(["menu","schedule","leave","identity","push_status","handoff","status","pending","continue","supplement","fill","done","clear","ticket","blocked","other"]);
const LABELS={menu:"菜单",schedule:"排班查询",leave:"请假调休查询",identity:"身份设置/查询",push_status:"推送状态",handoff:"交班状态",status:"运行状态",pending:"待办查询",continue:"继续/首页",supplement:"补充信息",fill:"重试填报",done:"生成腾讯草稿",clear:"清理本地追踪",ticket:"工单输入",blocked:"禁止的操作",other:"其他",text:"文字",image:"图片",button:"按钮",short:"短口令",long:"完整口令/自然表达",group:"群聊",private:"私聊",handler_returned:"入口处理结束（非业务成功）",worker_returned:"工单处理器返回（未细分）",denied:"权限/策略拒绝",clarification:"待补充字段",source_conflict:"排班源存在冲突",recognition_invalid:"识别结果格式异常",identifiers_invalid:"单号格式需核对",write_review:"写入前保护/本机核验",browser_incomplete:"浏览器流程未确认完成",registration_verified:"飞书登记已核验",submission_unverified:"提交结果待核验",draft_returned:"草稿仓库返回（未独立验收）",failed:"程序处理失败",module_missing:"缺少程序模块",timeout:"超时",connection:"连接异常",platform_rejected:"平台拒绝响应",source_unavailable:"源数据读取或校验未完成",runtime:"其他程序错误"};
const ERROR_TAGS=new Set(["duty agent failed","text handler error","image handler error","image download failed","queue error","按钮处理失败","任务状态更新失败","排班消息处理失败，请重试","排班定时器异常，稍后重试","排班读取或核验失败，未发送旧数据，5分钟后重试","排班发送状态保存异常，保留发送标记，禁止本时段自动重复","排班源读取失败","排班身份保存失败","ping fail","ws error","handshake rejected","auth failed","连接90秒无响应，关闭旧连接并退避重连","notify endpoint error"]);
function errorCategory(error){
  const text=String(error?.code||"")+" "+String(error?.message||error||"");
  if(/ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find module/i.test(text))return "module_missing";
  if(/timeout|timed out|超时/i.test(text))return "timeout";
  if(/ECONN|ENOTFOUND|EPIPE|socket|WebSocket|fetch failed/i.test(text))return "connection";
  if(/ack errcode/i.test(text))return "platform_rejected";
  return "runtime";
}
function commandCategory(role,text,hasImages){
  if(remoteDenial(text))return "blocked";
  if(role==="roster"){
    const value=normalizeRosterCommand(text);
    if(/^(?:查看排班|我的排班|我今天什么班|我明天什么班)(?:\s|$)/u.test(value))return "schedule";
    if(/^(?:请假|调休)(?:检查|候选)/u.test(value))return "leave";
    if(/^(?:排班身份|我的排班身份|我是)/u.test(value))return "identity";
    if(value==="排班推送状态")return "push_status";
    if(value==="动力交班状态")return "handoff";
  }else{
    const value=require("./ticket-policy.cjs").normalizeTicketCommand(text);
    const routes={pending:"pending",fill:"fill",done:"done",forget:"clear",as:"identity",user:"identity",draft:"ticket"};
    const command=value.match(/^\/(pending|fill|done|forget|as|user|draft)(?:\s|$)/i);
    if(command)return routes[command[1].toLowerCase()];
    if(/^(?:补充|补)\s/u.test(value))return "supplement";
    if(["继续","继续处理","首页","我的工单","还有哪些没处理","待办"].includes(value))return "continue";
    if(hasImages||/工单|周报|交接班/u.test(value))return "ticket";
  }
  if(!text||/^(?:BOT|菜单|帮助|\/help)$/iu.test(text))return "menu";
  if(/^(?:状态|运行状态|健康|\/status)$/iu.test(text))return "status";
  return "other";
}
function createObservability({root,role,now=Date.now}){
  if(!["roster","ticket"].includes(role))throw Error("Invalid observation role");
  const dir=path.join(root,"logs","observability"),file=path.join(dir,"events.log"),active=new WeakMap();
  let timer=null,closed=false,dropped=0,lastWriteAt=null;
  function record(value){
    try{
      // Allowlist every persisted value: never serialize the frame, text, error or extra fields.
      const event={v:1,at:Math.floor(now()/60000)*60000,role};
      if(value.type==="usage"&&CATEGORIES.has(value.category))Object.assign(event,{type:"usage",category:value.category,input:["text","image","button","other"].includes(value.input)?value.input:"other",channel:value.channel==="group"?"group":"private",form:["short","long","button","image","other"].includes(value.form)?value.form:"other"});
      else if(value.type==="result"&&OUTCOMES.has(value.outcome))Object.assign(event,{type:"result",outcome:value.outcome,durationMs:Math.min(86400000,Math.max(0,Math.round(Number(value.durationMs)||0)))});
      else if(value.type==="error"&&ERRORS.has(value.error))Object.assign(event,{type:"error",error:value.error});
      else return;
      appendRotatingLog(file,JSON.stringify(event)+"\n",{maxBytes:1024*1024,keep:5});lastWriteAt=event.at;
      if(!timer&&!closed){timer=setTimeout(()=>{timer=null;flush();},60000);timer.unref();}
    }catch{dropped++;}
  }
  function start(frame){
    if(active.has(frame))return;
    const body=frame.body||{},text=String(body.text?.content||"").replace(/^(\s*@[^\s@]+\s*)+/u,"").trim(),input=frame.__cardAction?"button":["image","mixed"].includes(body.msgtype)?"image":body.msgtype==="text"?"text":"other";
    active.set(frame,{at:Number.isFinite(frame.__observedAt)?frame.__observedAt:now(),deferred:false,outcome:null});
    record({type:"usage",category:commandCategory(role,text,input==="image"),input,channel:body.chattype,form:input==="button"||input==="image"?input:/^(?:班|今|明|我|单|清全部|确认清全部|推送|交班|菜单|状态)$|^(?:我|人|补)\s|^(?:填|完|清)\s*\d|^休(?:$|今|明|本月|下月|20\d{2}-)/u.test(text)?"short":text?"long":"other"});
  }
  function mark(frame,outcome){const item=active.get(frame);if(item&&OUTCOMES.has(outcome))item.outcome=outcome;}
  function finish(frame,fallback="handler_returned",force=false){const item=active.get(frame);if(!item||item.deferred&&!force)return;active.delete(frame);record({type:"result",outcome:item.outcome||fallback,durationMs:now()-item.at});}
  function flush(){
    try{
      const counts={usage:{},input:{},form:{},channel:{},results:{},errors:{}},durations=[],verified=[];let samples=0,oldest=null;
      const add=(bucket,key)=>bucket[key]=(bucket[key]||0)+1;
      for(const name of ["events.log",...Array.from({length:5},(_,i)=>`events.${i+1}.log`)]){
        let data;try{data=fs.readFileSync(path.join(dir,name),"utf8");}catch(error){if(error.code==="ENOENT")continue;throw error;}
        for(const line of data.split("\n")){let event;try{event=JSON.parse(line);}catch{continue;}
          if(event.v!==1||event.role!==role||!Number.isFinite(event.at)||event.at<now()-30*86400000||event.at>now())continue;
          if(event.type==="usage"&&CATEGORIES.has(event.category)){add(counts.usage,event.category);for(const [key,allowed] of [["input",["text","image","button","other"]],["form",["short","long","button","image","other"]],["channel",["group","private"]]])if(allowed.includes(event[key]))add(counts[key],event[key]);}
          else if(event.type==="result"&&OUTCOMES.has(event.outcome)&&Number.isFinite(event.durationMs)&&event.durationMs>=0&&event.durationMs<=86400000){add(counts.results,event.outcome);durations.push(event.durationMs);if(event.outcome==="registration_verified")verified.push(event.durationMs);}
          else if(event.type==="error"&&ERRORS.has(event.error))add(counts.errors,event.error);
          else continue;
          samples++;oldest=oldest===null?event.at:Math.min(oldest,event.at);
        }
      }
      const lines=["# 机器人使用与问题摘要",`生成：${new Date(now()).toISOString()}；角色：${role}`,`窗口：近30天，最多6MiB事件；保留窗口内事件${samples}条；最早：${oldest===null?"暂无":new Date(oldest).toISOString()}`,"只含匿名汇总，无个人画像；历史旧日志不导入。handler_returned/worker_returned只表示处理器返回，不代表在线登记成功。",""];
      for(const [key,title] of Object.entries({usage:"指令类别",input:"输入方式",form:"口令形式",channel:"群聊与私聊",results:"处理结果",errors:"错误类别"})){lines.push(`## ${title}`,...Object.entries(counts[key]).sort((a,b)=>b[1]-a[1]).map(([name,count])=>`- ${LABELS[name]}：${count}`));if(!Object.keys(counts[key]).length)lines.push("暂无样本");lines.push("");}
      const latency=(values)=>{values.sort((a,b)=>a-b);return values.length?`样本${values.length}；中位数${(values[Math.floor(values.length/2)]/1000).toFixed(1)}秒${values.length>=20?`；P95 ${(values[Math.ceil(values.length*.95)-1]/1000).toFixed(1)}秒`:"；不足20例不报告P95"}`:"暂无样本";};
      lines.push("## 耗时",`全部处理：${latency(durations)}`,`飞书登记核验：${latency(verified)}`,`登记≤60秒：${verified.filter(ms=>ms<=60000).length}/${verified.length}（仅明确核验样本，不含结果不明、表单模式或进程中断）`,"计时从本次消息接收开始，包含下载和排队；不是跨多轮补充的整单总耗时。", "", "## 改进建议（本地规则生成，维护者复核后实施）");
      let suggestions=0;
      if(Object.keys(counts.errors).length){lines.push("- 优先核对上方错误类别与现有本机诊断日志；匿名摘要不能还原具体原文。");suggestions++;}
      if((counts.results.clarification||0)+(counts.results.recognition_invalid||0)>=3){lines.push("- 已有至少3次识别或补充问题，建议离线核对图片清晰度、字段裁剪和确认提示；不要自动猜姓名或单号。");suggestions++;}
      if(verified.some(ms=>ms>60000)){lines.push("- 存在登记超过60秒的样本，建议检查排队、识别和浏览器阶段；保留查重与写后核验。");suggestions++;}
      if(counts.usage.other>=3){lines.push("- 未分类输入至少3次，建议维护者补充可复现的触发场景，再决定是否调整短口令。");suggestions++;}
      if(!suggestions)lines.push("- 暂无足够证据建议修改；继续积累真实样本。");
      lines.push("",`采集写入失败累计（本次进程）：${dropped}；无模型调用，无自动修改或上线。`);
      fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,"report.md.tmp"),lines.join("\n")+"\n");fs.renameSync(path.join(dir,"report.md.tmp"),path.join(dir,"report.md"));return true;
    }catch{dropped++;return false;}
  }
  return {start,mark,finish,record,flush,defer:frame=>{const item=active.get(frame);if(item)item.deferred=true;},system:parts=>{if(ERROR_TAGS.has(parts[0]))record({type:"error",error:parts[0].startsWith("排班")?"source_unavailable":parts[0]==="ws error"?"connection":parts[0].startsWith("连接90")?"timeout":["auth failed","handshake rejected"].includes(parts[0])?"platform_rejected":errorCategory(parts.slice(1).join(" "))});},status:()=>({enabled:true,dropped,lastWriteAt}),close:()=>{closed=true;clearTimeout(timer);timer=null;flush();}};
}
module.exports={createObservability,errorCategory,OUTCOMES};
