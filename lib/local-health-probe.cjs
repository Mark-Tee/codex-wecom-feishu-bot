const {performance}=require("node:perf_hooks");
const NETWORK_CODES=new Set(["ECONNREFUSED","ECONNRESET","EPIPE","ETIMEDOUT","ENETUNREACH","EHOSTUNREACH","UND_ERR_CONNECT_TIMEOUT","UND_ERR_HEADERS_TIMEOUT","UND_ERR_BODY_TIMEOUT","UND_ERR_SOCKET"]);
function classifyProbeFailure(error,stage){
 if(error?.name==="TimeoutError"||error?.name==="AbortError")return "HEALTH_TIMEOUT";
 if(/^HEALTH_HTTP_[0-9]{3}$/.test(error?.code||""))return error.code;
 if(stage==="json")return "HEALTH_BAD_JSON";
 if(stage==="identity")return "HEALTH_BAD_RESPONSE";
 const code=error?.cause?.code||error?.code;
 return NETWORK_CODES.has(code)?`HEALTH_${code}`:"HEALTH_REQUEST_ERROR";
}
async function probeLocalHealth({port,timeoutMs=5000,fetchImpl=globalThis.fetch,now=()=>performance.now()}){
 if(!Number.isInteger(port)||port<1||port>65535){const error=new Error("本机健康端口配置无效");error.code="HEALTH_CONFIG_ERROR";error.phase="config";error.elapsedMs=0;throw error;}
 const started=now();let phase="request";
 try{
  const response=await fetchImpl(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(timeoutMs)});
  if(!response.ok){const error=new Error("本机健康HTTP状态异常");error.code=`HEALTH_HTTP_${response.status}`;throw error;}
  phase="json";const data=await response.json();phase="identity";
  if(data?.service!=="codex-wecom-bridge"||!Number.isInteger(data?.pid))throw Error("本机健康返回无效");
  return {...data,probeElapsedMs:Math.max(0,Math.round(now()-started))};
 }catch(error){
  const failure=new Error("本机健康探测失败");failure.code=classifyProbeFailure(error,phase);failure.phase=phase;failure.elapsedMs=Math.max(0,Math.round(now()-started));throw failure;
 }
}
module.exports={probeLocalHealth,classifyProbeFailure};
