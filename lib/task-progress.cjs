const PREFIX="@@BOT_STAGE ";
const crypto=require("node:crypto");
function taskStreamId(frame){return "duty_"+crypto.createHash("sha256").update(String(frame.body?.msgid||frame.headers?.req_id||crypto.randomUUID())).digest("hex").slice(0,24);}
const LABELS={recognizing:"正在识别工单…",checking:"正在核对飞书登记条件…"};
function progressReader(onStage){
  let pending="";
  return chunk=>{
    pending+=String(chunk);const lines=pending.split("\n");pending=lines.pop();
    if(pending.length>8192)pending="";
    for(const line of lines){if(!line.startsWith(PREFIX))continue;try{const value=JSON.parse(line.slice(PREFIX.length));if(Object.hasOwn(LABELS,value.stage))onStage(value.stage);}catch{}}
  };
}
function createTaskProgress(send,{initial="正在处理…",log=()=>{}}={}){
  let chain=Promise.resolve(),closed=false,label=initial,inFlight=false,lastStage="";
  const enqueue=(text,finish=false,metadata)=>{
    if(closed)return chain;if(finish)closed=true;
    chain=chain.catch(error=>log(error)).then(async()=>{inFlight=true;try{await send(text,finish,metadata);}finally{inFlight=false;}});return chain;
  };
  return {
    start:()=>enqueue(label),
    stage:value=>{if(!Object.hasOwn(LABELS,value)||lastStage===value||closed||(lastStage==="checking"&&value==="recognizing"))return;lastStage=value;if(label===LABELS[value])return;label=LABELS[value];enqueue(label).catch(log);},
    heartbeat:seconds=>{if(!closed&&!inFlight)enqueue(`${label} ${seconds}秒`).catch(log);},
    finish:(text,metadata)=>enqueue(text,true,metadata),
  };
}
module.exports={PREFIX,progressReader,createTaskProgress,taskStreamId};
