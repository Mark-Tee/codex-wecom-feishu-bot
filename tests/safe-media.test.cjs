const test=require("node:test"),assert=require("node:assert/strict"),path=require("node:path"),fs=require("node:fs"),vm=require("node:vm"),{EventEmitter}=require("node:events");
const {mediaURL,isPublicAddress,mediaPath}=require("../lib/safe-media.cjs");
test("URL variants cannot reach private, mapped, metadata or non-HTTPS endpoints",()=>{
 for(const address of ["127.0.0.1","10.0.0.1","169.254.169.254","100.64.1.1","192.168.1.1","::1","::ffff:127.0.0.1","fc00::1","2001:db8::1","2002:7f00:1::"])assert.equal(!!isPublicAddress(address),false,address);
 for(const url of ["file:///C:/test","http://example.com","https://localhost","https://2130706433","https://0x7f000001","https://127.0.0.1:8799","https://[::ffff:127.0.0.1]","https://name:secret@example.com/x"])assert.throws(()=>mediaURL(url));
 assert.equal(mediaURL("https://example.com/x").hostname,"example.com");assert(isPublicAddress("8.8.8.8"));assert(isPublicAddress("2606:4700:4700::1111"));
});
test("media filenames are independent of message IDs, invalid dimensions and non-images are rejected",()=>{
 const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write("IHDR",12);png.writeUInt32BE(1080,16);png.writeUInt32BE(2400,20);
 const name=mediaPath("D:/test-cache",png);assert.equal(path.dirname(name),path.normalize("D:/test-cache"));assert.match(path.basename(name),/^[a-f0-9]{32}\.png$/);assert.notEqual(name,mediaPath("D:/test-cache",png));
 png.writeUInt32BE(100000,16);assert.throws(()=>mediaPath("D:/test-cache",png));assert.throws(()=>mediaPath("D:/test-cache",Buffer.from("MZ fake program")));
});
test("DNS answers are validated and pinned, redirects and streamed oversize bodies stop",async()=>{
 const source=fs.readFileSync(path.join(__dirname,"../lib/safe-media.cjs"),"utf8"),responses=[],dnsAnswers=[{address:"8.8.8.8",family:4}],sandbox={module:{exports:{}},Buffer,URL,AbortSignal,require:name=>name==="node:dns"?{lookup:(_host,_opts,callback)=>callback(null,dnsAnswers)}:name==="node:https"?{get:(_url,options,callback)=>{const request=new EventEmitter(),response=new EventEmitter();response.statusCode=responses.shift();response.headers={};response.destroy=error=>{if(error)queueMicrotask(()=>response.emit("error",error));};queueMicrotask(()=>{callback(response);if(response.statusCode===200){response.emit("data",Buffer.alloc(16*1024*1024+1));}});assert.equal(typeof options.lookup,"function");assert(options.signal);return request;}}:require(name)};
 vm.runInNewContext(source,sandbox);const api=sandbox.module.exports;
 await new Promise((resolve,reject)=>api.pinnedLookup("example.com",{all:true},(error,list)=>error?reject(error):(assert.equal(list[0].address,"8.8.8.8"),resolve())));
 dnsAnswers.push({address:"127.0.0.1",family:4});await new Promise(resolve=>api.pinnedLookup("example.com",{all:true},error=>{assert(error);resolve();}));
 responses.push(302);await assert.rejects(api.downloadImage("https://example.com"),/重定向/);responses.push(200);await assert.rejects(api.downloadImage("https://example.com"),/16MiB/);
});
