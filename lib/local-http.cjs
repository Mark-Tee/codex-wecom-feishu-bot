const {parseInbound}=require("./input-guard.cjs");
function localRequest(req,port){
  if(req.headers.origin||req.headers["sec-fetch-site"]&&req.headers["sec-fetch-site"]!=="none")return false;
  return ["127.0.0.1:"+port,"localhost:"+port,"[::1]:"+port].includes(String(req.headers.host||"").toLowerCase());
}
function readNotification(req){
  return new Promise((resolve,reject)=>{
    if(!/^application\/json(?:;|$)/i.test(req.headers["content-type"]||"")){req.resume();reject(Error("invalid"));return;}
    const chunks=[];let size=0,ended=false;const timer=setTimeout(()=>{finish(Error("timeout"));req.destroy();},5000);
    const finish=(error,value)=>{if(ended)return;ended=true;clearTimeout(timer);error?reject(error):resolve(value);};
    req.on("error",()=>finish(Error("invalid")));
    req.on("data",chunk=>{size+=chunk.length;if(size>8192){finish(Error("too_large"));req.resume();return;}if(!ended)chunks.push(chunk);});
    req.on("end",()=>{if(ended)return;const value=parseInbound(Buffer.concat(chunks));if(!value||Array.isArray(value)||typeof value.text!=="string"||!value.text.trim()||Buffer.byteLength(value.text)>4096){finish(Error("invalid"));return;}finish(null,{text:value.text});});
  });
}
module.exports={localRequest,readNotification};
