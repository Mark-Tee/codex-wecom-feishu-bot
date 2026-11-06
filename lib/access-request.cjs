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
  const approvedName=user=>Object.hasOwn(state.__approvedPeople||{},user)?state.__approvedPeople[user]:"";
  const bindings=()=>[...Object.entries(state.__schedulePeople||{}),...Object.entries(state.__accessPeople||{})];
  const ownNames=user=>[approvedName(user),...bindings().filter(([scope])=>{try{return JSON.parse(scope)[1]===user;}catch{return false;}}).map(([,name])=>name),...people().filter(item=>item.user===user).map(item=>item.name)].filter(Boolean);
  const conflict=(name,user)=>Object.entries(state.__approvedPeople||{}).some(([account,value])=>value===name&&account!==user)||people().some(item=>item.name===name&&item.user!==user)||bindings().some(([scope,value])=>{try{return value===name&&JSON.parse(scope)[1]!==user;}catch{return false;}});
  function persist(change){
    const previous=structuredClone({operators:state.__operators,requests:state.__accessRequests,people:state.__accessPeople,schedule:state.__schedulePeople,approved:state.__approvedPeople});
    change();try{save(state);}catch(error){
      for(const [field,value] of Object.entries({__operators:previous.operators,__accessRequests:previous.requests,__accessPeople:previous.people,__schedulePeople:previous.schedule,__approvedPeople:previous.approved})){if(value===undefined)delete state[field];else state[field]=value;}
      throw error;
    }
  }
  async function request(frame){
    const name=requestName(frame),user=frame.body.from.userid;
    if(name===null)return false;
    if(authorized(user)){
      if(approvedName(user)&&state.__approvedPeople[user]!==name){await reply(frame,"已批准身份不可自行更换，请联系维护者核对；未修改绑定。");return true;}
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
  function grant(item){
    if(allowUsers.length&&!allowUsers.includes(item.user))throw Error("固定白名单不允许此账号，请先核对配置。");
    if(!unique(item.name)||conflict(item.name,item.user))throw Error("姓名名单或账号绑定冲突，请人工核对，未授权。");
    if(ownNames(item.user).some(name=>name!==item.name))throw Error("该账号已有其他姓名，未覆盖绑定。");
    persist(()=>{
      state.__operators=[...new Set([...(state.__operators||[]),item.user])];
      state.__approvedPeople={...(state.__approvedPeople||{}),[item.user]:item.name};
      const field=role==="roster"?"__schedulePeople":"__accessPeople";
      state[field]||={};
      for(const chat of new Set([item.chat,"private:"+item.user]))state[field][key(item.user,chat)]=item.name;
      for(const request of records())if(request.user===item.user&&request.name===item.name)delete state.__accessRequests[request.id];
    });
  }
  function manage(text){
    const sync=String(text).match(/^sync ([A-Za-z0-9._@-]{1,128})$/);
    if(sync){
      const user=sync[1],names=[...new Set(ownNames(user))];
      if(!authorized(user)||names.length!==1)throw Error("只能补齐已授权且姓名唯一的账号，请人工核对。");
      grant({user,name:names[0],chat:"private:"+user});
      return {ok:true,action:"sync",name:names[0],message:"已补齐私聊和群聊默认身份；不同会话任务仍独立。"};
    }
    const match=String(text).match(/^(list|approve|reject)(?: ([a-f0-9]{16}))?$/);
    if(!match||match[1]!=="list"&&!match[2]||match[1]==="list"&&match[2])throw Error("用法：list / approve 申请编号 / reject 申请编号");
    if(match[1]==="list")return {ok:true,role,requests:records().filter(item=>item.expiresAt>now())};
    const item=state.__accessRequests?.[match[2]];
    if(!item||item.expiresAt<=now())throw Error("申请不存在、已处理或已过期；不要重复批准。");
    if(match[1]==="approve"){
      grant(item);
    }else persist(()=>{delete state.__accessRequests[item.id];});
    return {ok:true,action:match[1],id:item.id,name:item.name,message:match[1]==="approve"?"已批准私聊和群聊使用并绑定本人；各会话任务独立。请发送菜单。":"已拒绝，未授予权限。"};
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
  return {request,local,manage,authorized,allows:frame=>requestName(frame)!==null,identity:(user,chat)=>state.__accessPeople?.[key(user,chat)]||approvedName(user)||""};
}
module.exports={createAccessRequests,requestName};
