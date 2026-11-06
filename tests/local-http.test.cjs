const test=require("node:test"),assert=require("node:assert/strict"),{PassThrough}=require("node:stream");
const {localRequest,readNotification}=require("../lib/local-http.cjs");
test("loopback HTTP refuses browser origins and hostile Host headers",()=>{
 assert(localRequest({headers:{host:"127.0.0.1:8799"}},8799));
 for(const headers of [{host:"evil.example:8799"},{host:"127.0.0.1:8799",origin:"https://evil.example"},{host:"localhost:8799","sec-fetch-site":"cross-site"}])assert(!localRequest({headers},8799));
});
test("notification input is bounded JSON and does not accept scripts, objects or poisoning",async()=>{
 const run=(text,type="application/json")=>{const req=new PassThrough();req.headers={"content-type":type};const result=readNotification(req);req.end(text);return result;};
 assert.deepEqual(await run('{"text":"local maintenance notice"}'),{text:"local maintenance notice"});
 for(const [text,type] of [['{"text":{}}'],['{"text":"x","__proto__":{}}'],['x'.repeat(8193)],['{"text":"x"}','text/plain']])await assert.rejects(run(text,type));
});
