const crypto=require("node:crypto");
const MENUS={
  roster:[["今明排班","查看排班"],["今天","我今天什么班"],["明天","我明天什么班"],["我的身份","我的排班身份"],["推送状态","排班推送状态"],["指令说明",null]],
  ticket:[["我的待办","单"],["继续处理","继续"],["清理待办","清全部"],["运行状态","状态"],["指令说明",null]],
};
function scope(body){return body.chattype==="group"&&body.chatid?`group:${body.chatid}`:body.chattype==="single"&&body.from?.userid?`single:${body.from.userid}`:"";}
function createInteractionCards({role,state,save,authorized,send,reply,dispatch,help,canGenerate=()=>false,now=Date.now,log=()=>{}}){
  if(!MENUS[role])throw Error("Unknown card role");
  const persist=()=>save(state);
  const notify=(frame,text)=>reply({...frame,__plainHelp:true,__cardAction:frame.cmd==="aibot_event_callback"||frame.__cardAction},text);
  const mint=(frame,kind,actions,ttl)=>{
    const body=frame.body||{},chat=scope(body),owner=body.from?.userid;if(!chat||!owner)throw Error("Missing card owner/session");
    const id="ui_"+crypto.randomBytes(16).toString("hex");
    state.__interactionCards=Object.fromEntries(Object.entries(state.__interactionCards||{}).filter(([,value])=>value.expiresAt>now()).slice(-99));
    state.__interactionCards[id]={role,owner,chat,kind,actions,expiresAt:now()+ttl};persist();return id;
  };
  const deliver=(frame,card)=>frame.__cardAction
    ? send("aibot_send_msg",{chatid:frame.body.chattype==="group"?frame.body.chatid:frame.body.from.userid,chat_type:frame.body.chattype==="group"?2:1,msgtype:"template_card",template_card:card})
    : send("aibot_respond_msg",{msgtype:"template_card",template_card:card},frame.headers?.req_id);
  async function menu(frame){
    if(!authorized(frame.body?.from?.userid))return notify(frame,help);
    const items=MENUS[role].map(row=>[...row]);
    if(role==="roster"&&canGenerate(frame.body?.from?.userid))items.splice(2,1,["生成排班稿","生成排班稿"]);
    const actions=items.map(([text,command],index)=>({text,command,key:"m"+index})),id=mint(frame,"menu",actions,3600000);
    try{await deliver(frame,{card_type:"button_interaction",task_id:id,main_title:{title:role==="roster"?"排班机器人":"工单机器人",desc:role==="roster"?"排班身份 姓名：绑定；生成排班稿：维护者专用":"人 姓名：设置本人；发图建单；填12、完12"},button_list:actions.map(({text,key})=>({text,key,style:1}))});}
    catch(error){if(/ack errcode/i.test(error.message||""))await notify(frame,help);else throw error;}
  }
  async function confirmation(frame,text,action){
    if(action?.kind!=="forget-confirm"||!/^[a-f0-9]{64}$/.test(action.token||"")||[...text].length>112)return false;
    const actions=[{text:"确认清除",key:"confirm",command:`/forget confirm ${action.token}`},{text:"保留待办",key:"dismiss",command:`/forget dismiss ${action.token}`}],id=mint(frame,"confirmation",actions,300000);
    try{await deliver(frame,{card_type:"button_interaction",task_id:id,main_title:{title:"确认本人待办清理"},sub_title_text:text,button_list:actions.map(({text,key})=>({text,key,style:key==="confirm"?2:1}))});return true;}
    catch(error){if(/ack errcode/i.test(error.message||""))return false;throw error;}
  }
  async function handle(frame){
    const body={...(frame?.body||{})},event=body.event;
    if(frame?.cmd!=="aibot_event_callback"||event?.eventtype!=="template_card_event")return false;
    body.chattype ||= body.chatid?"group":"single";
    const payload=event.template_card_event||event;
    if(payload!==event&&((event.task_id!==undefined&&event.task_id!==payload.task_id)||(event.event_key!==undefined&&event.event_key!==payload.event_key))){log("卡片回调字段冲突，未执行");return true;}
    const id=payload.task_id,user=body.from?.userid,record=state.__interactionCards?.[id];
    const canQuery=()=>record&&record.role===role&&record.owner===user&&record.chat===scope(body)&&record.expiresAt>now()&&authorized(user);
    const ack=(text,keepButtons=false)=>send("aibot_respond_update_msg",{response_type:"update_template_card",userids:[user],template_card:{card_type:"button_interaction",task_id:id,main_title:{title:text},button_list:keepButtons?record.actions.map(({text,key})=>({text,key,style:1})):canQuery()?[{text:role==="ticket"?"查看待办":"查看排班",key:"status",style:1}]:[{text:"请重新@机器人",key:"unavailable",style:4}]}},frame.headers?.req_id);
    if(!user||!frame.headers?.req_id||!body.msgid||!/^ui_[a-f0-9]{32}$/.test(id||"")){log("卡片回调缺少有效身份或标识，未执行");return true;}
    let denied=!record||record.role!==role||record.expiresAt<=now()?"卡片已失效，请重新@机器人打开菜单":record.owner!==user||record.chat!==scope(body)?"请@机器人打开本人当前会话的卡片":!authorized(user)?"无权限，请联系维护者":record.used&&payload.event_key!=="status"?"本次确认不再重复执行，请查看待办":"";
    const action=payload.event_key==="status"?{key:"status",command:role==="ticket"?"单":"查看排班"}:record?.actions.find(value=>value.key===payload.event_key);
    if(!denied&&!action)denied="按钮无效，请重新打开菜单";
    if(!denied&&(state.__cardEvents||[]).includes(body.msgid))denied="本次点击已接收，请勿重复操作";
    if(denied){
      try{await ack(denied);}catch(error){await notify({...frame,body},denied).catch(()=>{});throw error;}
      await notify({...frame,body},denied);return true;
    }
    state.__cardEvents=[...(state.__cardEvents||[]),body.msgid].slice(-300);
    if(record.kind==="confirmation"&&action.key!=="status")record.used=true;
    persist();
    log("按钮请求已接收",role,action.key);
    // Acknowledge the event before reads/worker startup; an unknown ACK never dispatches work.
    try{await ack("已接收，请查看机器人回复",record.kind==="menu");}
    catch(error){
      await notify({...frame,body},"按钮确认未完成，本次未继续执行。\n下一步：发送“菜单”重新打开；清理待办需重新预览确认。").catch(()=>{});
      throw error;
    }
    const request={...frame,cmd:"aibot_msg_callback",__cardAction:true,body:{...body,msgid:"card_"+body.msgid,msgtype:"text",text:{content:action.command||"/help"}}};
    if(action.command===null)await notify(request,help);else await dispatch(request);
    return true;
  }
  return {menu,confirmation,handle};
}
module.exports={createInteractionCards};
