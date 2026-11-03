const https=require("node:https"),dns=require("node:dns"),net=require("node:net"),crypto=require("node:crypto"),path=require("node:path");
const blocked=new net.BlockList();
for(const [ip,bits] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",3]])blocked.addSubnet(ip,bits,"ipv4");
const global6=new net.BlockList();global6.addSubnet("2000::",3,"ipv6");
for(const [ip,bits] of [["2001::",23],["2001:db8::",32],["2002::",16],["3fff::",20]])blocked.addSubnet(ip,bits,"ipv6");
function isPublicAddress(address){const kind=net.isIP(address);return kind===4?!blocked.check(address,"ipv4"):kind===6&&global6.check(address,"ipv6")&&!blocked.check(address,"ipv6");}
function mediaURL(value){
  const url=new URL(value),host=url.hostname.replace(/^\[|\]$/g,"");
  if(url.protocol!=="https:"||url.username||url.password||url.port&&url.port!=="443"||host.toLowerCase()==="localhost"||host.endsWith(".localhost")||net.isIP(host)&&!isPublicAddress(host))throw Error("图片地址不允许访问本机、内网或非HTTPS服务");
  return url;
}
function pinnedLookup(host,options,callback){
  dns.lookup(host,{all:true,verbatim:true},(error,addresses)=>{
    if(error)return callback(error);
    if(!addresses.length||addresses.some(item=>!isPublicAddress(item.address)))return callback(Error("图片域名解析到非公网地址"));
    if(options.all)return callback(null,addresses);
    const selected=addresses.find(item=>!options.family||item.family===options.family);if(!selected)return callback(Error("图片地址不可用"));callback(null,selected.address,selected.family);
  });
}
function downloadImage(value){
  return new Promise((resolve,reject)=>{
    let url;try{url=mediaURL(value);}catch(error){reject(error);return;}
    const request=https.get(url,{lookup:pinnedLookup,signal:AbortSignal.timeout(15000),headers:{"accept-encoding":"identity"}},response=>{
      if(response.statusCode!==200){response.destroy();reject(Error("图片请求被拒绝，禁止重定向"));return;}
      const limit=16*1024*1024;if(Number(response.headers["content-length"])>limit){response.destroy();reject(Error("图片超过16MiB"));return;}
      const chunks=[];let size=0;
      response.on("data",chunk=>{size+=chunk.length;if(size>limit){response.destroy(Error("图片超过16MiB"));return;}chunks.push(chunk);});
      response.on("error",reject);response.on("end",()=>resolve(Buffer.concat(chunks)));
    });request.on("error",reject);
  });
}
function mediaPath(root,buffer){
  const png=buffer.length>=8&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpg=buffer.length>=3&&buffer[0]===255&&buffer[1]===216&&buffer[2]===255;
  if(!png&&!jpg)throw Error("仅接受PNG/JPEG工单图片，请重新发送清晰截图");
  let width=0,height=0;
  if(png&&buffer.length>=24&&buffer.toString("ascii",12,16)==="IHDR"){width=buffer.readUInt32BE(16);height=buffer.readUInt32BE(20);}
  if(jpg){
    let offset=2;
    while(offset+4<=buffer.length){
      if(buffer[offset++]!==255)break;while(buffer[offset]===255)offset++;
      const marker=buffer[offset++];if(marker===217||marker===218)break;
      if(marker===1||marker>=208&&marker<=215)continue;
      if(offset+2>buffer.length)break;const length=buffer.readUInt16BE(offset);if(length<2||offset+length>buffer.length)break;
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=7){height=buffer.readUInt16BE(offset+3);width=buffer.readUInt16BE(offset+5);break;}offset+=length;
    }
  }
  if(!width||!height||width>12000||height>12000||width*height>40000000)throw Error("图片尺寸无效或过大，请压缩后重新发送");
  return path.join(root,crypto.randomBytes(16).toString("hex")+(png?".png":".jpg"));
}
module.exports={downloadImage,mediaPath,mediaURL,isPublicAddress,pinnedLookup};
