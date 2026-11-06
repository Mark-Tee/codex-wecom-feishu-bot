function handoffSlot(at) {
  const clock=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Shanghai",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(at);
  const date=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(at);
  if(clock>="16:30"&&clock<"16:35")return {id:"white",key:date+":white",date,time:"16:30"};
  if(clock>="07:30"&&clock<"07:35")return {id:"night",key:date+":night",date,time:"07:30"};
  return null;
}

function recipientFor(state, name, authorized) {
  const namesByUser=new Map();
  for(const [key,value] of Object.entries(state.__schedulePeople||{})) {
    let user=key;
    try {const parts=JSON.parse(key);if(!Array.isArray(parts)||parts.length!==2)continue;user=parts[1];} catch {if(key.startsWith("["))continue;}
    if(typeof user!=="string"||!user||!authorized(user))continue;
    if(!namesByUser.has(user))namesByUser.set(user,new Set());
    namesByUser.get(user).add(value);
  }
  const users=[...namesByUser].filter(([,names])=>names.has(name));
  return users.length===1&&users[0][1].size===1?users[0][0]:"";
}

function createPowerHandoff({state,save,schedule,draft,send,authorized,ready=()=>true,now=()=>new Date(),enabledAt,log=()=>{}}) {
  let busy=false;
  const retryAt={};
  async function tick() {
    const at=now(),slot=handoffSlot(at);
    if(!slot||busy||!ready()||!Number.isFinite(Date.parse(enabledAt)))return;
    const start=Date.parse(`${slot.date}T${slot.time}:00+08:00`);
    if(Date.parse(enabledAt)>start||at.getTime()<(retryAt[slot.id]||0))return;
    state.__powerHandoffDeliveries||={};
    const previous=state.__powerHandoffDeliveries[slot.id];
    if(previous?.key===slot.key&&["sending","sent","unknown","unbound"].includes(previous.status))return;
    if(!Object.values(state.__schedulePeople||{}).length)return;
    busy=true;
    try {
      const context=await schedule(at),user=recipientFor(state,context.owner,authorized);
      if(!user){state.__powerHandoffDeliveries[slot.id]={key:slot.key,status:"unbound",owner:context.owner,at:at.toISOString()};save(state);return;}
      const text=await draft(context,at);
      const current=now();
      if(handoffSlot(current)?.key!==slot.key||!ready()||recipientFor(state,context.owner,authorized)!==user)return;
      const record={key:slot.key,status:"sending",owner:context.owner,user,at:current.toISOString()};
      state.__powerHandoffDeliveries[slot.id]=record;save(state);
      try {await send(user,text);record.status="sent";} catch {record.status="unknown";log("动力交班私聊结果不确定，停止本班自动重发，请本机核验");}
      save(state);
    } catch {
      const record=state.__powerHandoffDeliveries[slot.id];
      if(record?.key===slot.key&&["sending","sent","unknown"].includes(record.status))return;
      retryAt[slot.id]=at.getTime()+60000;
      state.__powerHandoffDeliveries[slot.id]={key:slot.key,status:"read-failed",at:at.toISOString()};
      try{save(state);}catch{}
      log("动力交班只读核验失败，不发旧数据；窗口内一分钟后重试");
    } finally {busy=false;}
  }
  function status(user) {
    if(!Number.isFinite(Date.parse(enabledAt)))return "动力交班启用时间配置无效。\n下一步：联系维护者检查本机配置，尚不会自动发送。";
    const records=Object.values(state.__powerHandoffDeliveries||{}).filter(row=>row.user===user||(row.owner&&recipientFor(state,row.owner,authorized)===user));
    const bound=[...new Set(Object.values(state.__schedulePeople||{}))].some(name=>recipientFor(state,name,authorized)===user);
    const labels={sent:"接口确认已发送",sending:"发送中或中断待核验",unknown:"发送结果待本机核验，不自动重发",unbound:"生成时身份未唯一绑定，未发送", "read-failed":"只读核验失败，未发送"};
    let next=bound?"身份已绑定，轮到动力班时自动生成；收到后交班前复核。":"发送“排班身份 本人姓名”，并确认没有账号或姓名冲突。";
    if(records.some(row=>["sending","unknown"].includes(row.status)))next="联系维护者核验发送记录，不要自动重发。";
    else if(records.some(row=>row.status==="read-failed"))next="窗口内等待自动重试；仍未收到时联系维护者检查在线排班或飞书登录。";
    else if(records.some(row=>row.status==="unbound"))next="核对本人姓名和账号冲突；本次不补发，下次动力班按最新绑定处理。";
    else if(records.length)next="收到后交班前复核新增任务、分类、人员和实际交接状态，修正后再发群。";
    return ["【动力交班私聊】","动力白班16:30；动力夜班次日07:30。","按已绑定身份和最新排班，仅私聊当班动力人员。",...records.map(row=>`${row.key.replace(":white"," 白班交班提醒").replace(":night"," 夜班交班提醒")}：${labels[row.status]||row.status}`),`下一步：${next}`].join("\n");
  }
  return {tick,status};
}
module.exports={createPowerHandoff,recipientFor,handoffSlot};
