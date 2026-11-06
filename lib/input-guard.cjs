const MAX_FRAME=256*1024,MAX_TEXT=16*1024;
const plain=value=>value!==null&&typeof value==="object"&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const id=value=>typeof value==="string"&&value.length>0&&value.length<=256&&!/[\s\x00-\x1f\x7f]/u.test(value)&&!["__proto__","constructor","prototype"].includes(value);
function parseInbound(raw){
  if(!(typeof raw==="string"||Buffer.isBuffer(raw))||Buffer.byteLength(raw)>MAX_FRAME)return null;
  const parse=text=>{
    const value=JSON.parse(text,(key,value)=>{if(["__proto__","constructor","prototype"].includes(key))throw Error("Unsafe JSON key");return value;});
    if(!plain(value)||value.cmd!==undefined&&(typeof value.cmd!=="string"||value.cmd.length>80)||value.errcode!==undefined&&!Number.isInteger(value.errcode)||value.errmsg!==undefined&&(typeof value.errmsg!=="string"||value.errmsg.length>4096))throw Error("Invalid envelope");
    return value;
  };
  try{return parse(String(raw));}catch{}
  try{return parse(String(raw).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g,ch=>"\\u"+ch.charCodeAt(0).toString(16).padStart(4,"0")));}catch{return null;}
}
function envelope(frame){
  if(!plain(frame)||!plain(frame.headers)||!id(frame.headers.req_id)||!plain(frame.body)||!plain(frame.body.from)||!id(frame.body.from.userid))return false;
  const body=frame.body,type=body.chattype||(body.chatid?"group":"single");
  return ["group","single"].includes(type)&&(type!=="group"||id(body.chatid));
}
function validateFrame(frame){
  if(!envelope(frame)||!id(frame.body.msgid))return "invalid_envelope";
  const body=frame.body;
  if(frame.cmd==="aibot_event_callback"){
    if(!plain(body.event)||body.event.eventtype!=="template_card_event")return "invalid_event";
    const event=body.event.template_card_event||body.event;
    return plain(event)&&typeof event.task_id==="string"&&/^ui_[a-f0-9]{32}$/.test(event.task_id)&&typeof event.event_key==="string"&&/^(?:m[0-5]|confirm|dismiss|status|unavailable)$/.test(event.event_key)?"":"invalid_card";
  }
  if(frame.cmd!=="aibot_msg_callback")return "invalid_event";
  const validText=value=>plain(value)&&typeof value.content==="string"&&Buffer.byteLength(value.content)<=MAX_TEXT&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value.content);
  const validImage=value=>plain(value)&&typeof value.url==="string"&&value.url.length<=4096&&(value.aeskey===undefined||typeof value.aeskey==="string"&&value.aeskey.length<=128);
  if(body.msgtype==="text")return validText(body.text)?"":"invalid_text";
  if(body.msgtype==="image")return validImage(body.image)?"":"invalid_image";
  if(body.msgtype!=="mixed")return "unsupported_type";
  if(!plain(body.mixed)||!Array.isArray(body.mixed.msg_item)||body.mixed.msg_item.length<1||body.mixed.msg_item.length>12)return "invalid_mixed";
  let images=0,textBytes=0;
  for(const item of body.mixed.msg_item){
    if(!plain(item))return "invalid_mixed";
    if(item.msgtype==="image"&&validImage(item.image)){images++;continue;}
    if(item.msgtype==="text"&&validText(item.text)){textBytes+=Buffer.byteLength(item.text.content);continue;}
    return "invalid_mixed";
  }
  return images<=4&&textBytes<=MAX_TEXT?"":"message_too_large";
}
const MESSAGES={unauthorized:"尚未授权。请发送“我 本人姓名”申请，等待维护者在本机确认。",rate_limited:"请求过于频繁，请稍后再试。",busy:"请求较多，请稍后重试；不要重复提交工单。",duplicate:"这条消息已接收，请勿重复发送。"};
function createIngressGuard({authorized,allowRequest=()=>false,now=Date.now}){
  const windows=new Map(),responses=new Map(),seen=new Map();let global={at:0,count:0},running=0,media=0;
  function check(frame){
    const canReply=envelope(frame),user=canReply?frame.body.from.userid:"",at=now();
    const reject=code=>{let reply=canReply;if(reply){const last=responses.get(user);reply=last===undefined||at-last>=10000;if(reply){if(responses.size>=1000)responses.clear();responses.set(user,at);}}return {ok:false,code,reply,text:MESSAGES[code]||"消息格式或长度不符合要求，请发送“菜单”查看用法；工单图片每条最多4张。"};};
    const invalid=validateFrame(frame);if(invalid)return reject(invalid);
    if(!authorized(user)&&!allowRequest(frame))return reject("unauthorized");
    if(at-global.at>=60000)global={at,count:0};
    if(global.count>=60)return reject("rate_limited");
    if(windows.size>=1000)for(const [key,value] of windows)if(at-value.at>=60000)windows.delete(key);
    let window=windows.get(user);if(!window||at-window.at>=60000){if(windows.size>=1000&&!windows.has(user))return reject("busy");window={at,count:0};windows.set(user,window);}
    if(window.count>=20)return reject("rate_limited");
    const isMedia=["image","mixed"].includes(frame.body.msgtype);
    if(running>=4||isMedia&&media>=2)return reject("busy");
    const key=JSON.stringify([frame.cmd,user,frame.body.msgid]);
    for(const [key,expiry] of seen)if(expiry<=at)seen.delete(key);
    if(seen.has(key))return reject("duplicate");
    if(seen.size>=2000)return reject("busy");
    seen.set(key,at+600000);window.count++;global.count++;running++;if(isMedia)media++;
    let released=false;return {ok:true,release(){if(released)return;released=true;running--;if(isMedia)media--;}};
  }
  return {check,status:()=>({running,media})};
}
function validateWorkerMessage(value){
  return plain(value)&&(value.id===undefined||typeof value.id==="string"&&value.id.length>0&&value.id.length<=256&&!/[\x00-\x1f]/u.test(value.id))&&id(value.userId)&&id(value.chatId)&&typeof value.text==="string"&&Buffer.byteLength(value.text)<=MAX_TEXT&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value.text)&&(value.images===undefined||Array.isArray(value.images)&&value.images.length<=4&&value.images.every(image=>plain(image)&&typeof image.path==="string"&&image.path.length<=1024))&&(value.boundOperator===undefined||typeof value.boundOperator==="string"&&value.boundOperator.length<=80&&!/[\x00-\x1f\x7f]/u.test(value.boundOperator))&&(!value.ocrText||typeof value.ocrText==="string"&&Buffer.byteLength(value.ocrText)<=128*1024);
}
module.exports={parseInbound,validateFrame,validateWorkerMessage,createIngressGuard,MAX_FRAME,MAX_TEXT};
