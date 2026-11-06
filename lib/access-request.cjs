const crypto=require("node:crypto");
const {readNotification,localRequest}=require("./local-http.cjs");
const {normalizeRosterCommand}=require("./roster-command.cjs");
function requestName(frame){
  if(frame?.cmd!=="aibot_msg_callback"||frame.body?.msgtype!=="text")return null;
  const raw=frame.body.text?.content;
  if(typeof raw!=="string"||raw.length>160)return null;
  const text=normalizeRosterCommand(raw.replace(/^(\s*@[^\s@]+\s*)+/u,"").trim());
  const match=text.match(/^(?:排班身份|我是|我|人|\/as)\s*([\p{L}·]{1,40})$/u);
  return match?.[1]||null;
}
function createAccessRequests({state,save,members,people=()=>[],reply,role,allowUsers=[],secret,port,now=Date.now}){
  const authorized=user=>allowUsers.length?allowUsers.includes(user):(state.__operators||[]).includes(user);
  const key=(user,chat)=>JSON.stringify([chat,user]);
  const scope=frame=>frame.body.chattype==="group"?frame.body.chatid:"private:"+frame.body.from.userid;
  const records=()=>Object.values(state.__accessRequests||{});
  const unique=name=>members().filter(value=>value===name).length===1;
  const conflict=(name,user)=>people().some(item=>item.name===name&&item.user!==user)||[...Object.entries(state.__schedulePeople||{}),...Object.entries(state.__accessPeople||{})].some(([scope,value])=>{try{return value===name&&JSON.parse(scope)[1]!==user;}catch{return false;}});
  function persist(change){
    const previous=structuredClone({operators:state.__operators,requests:state.__accessRequests,people:state.__accessPeople,schedule:state.__schedulePeople});
    change();try{save(state);}catch(error){
      for(const [field,value] of Object.entries({__operators:previous.operators,__accessRequests:previous.requests,__accessPeople:previous.people,__schedulePeople:previous.schedule})){if(value===undefined)delete state[field];else state[field]=value;}
      throw error;
    }
  }
  async function request(frame){
    const name=requestName(frame),user=frame.body.from.userid;
    if(name===null)return false;
    if(authorized(user)){
      if(conflict(name,user)){await reply(frame,"该姓名已有其他账号绑定，请联系维护者核对；未修改身份。");return true;}
      return false;
    }
    if(allowUsers.length){await reply(frame,"当前启用固定白名单，请联系维护者在本机确认使用范围。");return true;}
    if(!unique(name)){await reply(frame,"姓名未匹配当前机器人的唯一成员名单。请发送“我 本人准确姓名”；仍不匹配请联系维护者。");return true;}
    if(conflict(name,user)){await reply(frame,"该姓名已有其他账号绑定，请联系维护者核对；未授予权限。");return true;}
    const at=now(),chat=scope(frame),existing=records().find(item=>item.user===user&&item.chat===chat&&item.expiresAt>at);
    if(existing){await reply(frame,`申请 ${existing.id} 正在等待本机确认（${existing.name}）。姓名有误请让维护者拒绝后重新申请；确认前不能使用业务功能。`);return true;}
    const live=records().filter(item=>item.expiresAt>at);
    if(live.length>=20){await reply(frame,"待确认申请较多，请稍后再试或联系维护者；尚未授权。");return true;}
    const item={id:crypto.randomBytes(8).toString("hex"),user,chat,name,expiresAt:at+3600000};
    persist(()=>{state.__accessRequests=Object.fromEntries([...live,item].map(item=>[item.id,item]));});
    await reply(frame,`已收到“${name}”的使用申请，等待维护者在本机核对并确认。申请1小时有效；确认后重新@我发“菜单”。确认前不能查询或处理工单。`);
    return true;
  }
  function manage(text){
    const match=String(text).match(/^(list|approve|reject)(?: ([a-f0-9]{16}))?$/);
    if(!match||match[1]!=="list"&&!match[2]||match[1]==="list"&&match[2])throw Error("用法：list / approve 申请编号 / reject 申请编号");
    if(match[1]==="list")return {ok:true,role,requests:records().filter(item=>item.expiresAt>now())};
    const item=state.__accessRequests?.[match[2]];
    if(!item||item.expiresAt<=now())throw Error("申请不存在、已处理或已过期；不要重复批准。");
    if(match[1]==="approve"){
      if(allowUsers.length&&!allowUsers.includes(item.user))throw Error("固定白名单不允许此账号，请先核对配置。");
      if(!unique(item.name)||conflict(item.name,item.user))throw Error("姓名名单或账号绑定冲突，请人工核对，未授权。");
      const previous=(role==="roster"?state.__schedulePeople:state.__accessPeople)?.[key(item.user,item.chat)];
      if(previous&&previous!==item.name)throw Error("此会话已有其他姓名，未覆盖绑定。");
    }
    persist(()=>{
      if(match[1]==="approve"){
        state.__operators=[...new Set([...(state.__operators||[]),item.user])];
        const field=role==="roster"?"__schedulePeople":"__accessPeople";
        state[field]||={};state[field][key(item.user,item.chat)]=item.name;
      }
      delete state.__accessRequests[item.id];
    });
    return {ok:true,action:match[1],id:item.id,name:item.name,message:match[1]==="approve"?"已授权并绑定申请会话；请本人重新@机器人发送菜单。":"已拒绝，未授予权限。"};
  }
  function local(req,res){
    if(req.url!=="/access-requests")return false;
    const respond=(status,value)=>{res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});res.end(JSON.stringify(value));};
    const actual=Buffer.from(req.headers.authorization||""),expected=Buffer.from("Bearer "+(secret||""));
    if(!secret||!localRequest(req,port)||actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected)){req.resume();respond(403,{ok:false,error:"Forbidden"});return true;}
    if(req.method!=="POST"){req.resume();respond(405,{ok:false,error:"POST required"});return true;}
    readNotification(req).then(({text})=>{try{respond(200,manage(text));}catch(error){respond(409,{ok:false,error:error.message});}}).catch(()=>respond(400,{ok:false,error:"请求格式不正确"}));
    return true;
  }
  return {request,local,manage,authorized,allows:frame=>requestName(frame)!==null,identity:(user,chat)=>state.__accessPeople?.[key(user,chat)]||""};
}
module.exports={createAccessRequests,requestName};
