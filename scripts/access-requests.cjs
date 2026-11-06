#!/usr/bin/env node
const fs=require("node:fs"),path=require("node:path"),http=require("node:http");
const root=path.resolve(__dirname,".."),{readServiceProfile}=require("../lib/service-profile.cjs");
async function run(){
  const args=process.argv.slice(2),command=args.join(" ");
  if(!/^(?:list|(?:approve|reject) [a-f0-9]{16}|sync [A-Za-z0-9._@-]{1,128})$/.test(command))throw Error("在对应机器人目录运行：node scripts/access-requests.cjs list；核对后 approve 申请编号 / reject 申请编号；sync 已授权账号补齐两种会话身份。两个机器人分别确认。");
  const cfg=JSON.parse(fs.readFileSync(path.join(root,"config.json"),"utf8").replace(/^\uFEFF/,"")),profile=readServiceProfile(root);
  if(!cfg.secret)throw Error("本机机器人凭证缺失");
  const data=JSON.stringify({text:command});
  const result=await new Promise((resolve,reject)=>{
    const req=http.request({hostname:"127.0.0.1",port:profile.healthPort,path:"/access-requests",method:"POST",headers:{authorization:"Bearer "+cfg.secret,"content-type":"application/json","content-length":Buffer.byteLength(data)}},res=>{
      let text="",size=0;res.on("data",chunk=>{size+=chunk.length;if(size>65536){req.destroy();reject(Error("响应过大"));return;}text+=chunk;});res.on("end",()=>{try{const value=JSON.parse(text);value.ok?resolve(value):reject(Error(value.error||"操作未完成"));}catch(error){reject(error);}});res.on("error",()=>reject(Error("本机响应中断")));
    });req.setTimeout(5000,()=>req.destroy());req.on("error",()=>reject(Error("无法连接本机机器人，请检查运行状态；不要重复批准未知结果。")));req.end(data);
  });
  console.log(JSON.stringify(result,null,2));
}
run().catch(error=>{console.error(error.message);process.exitCode=1;});
