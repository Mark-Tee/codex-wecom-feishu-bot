const test=require("node:test"),assert=require("node:assert/strict"),{PassThrough}=require("node:stream");
const {createAccessRequests,requestName}=require("../lib/access-request.cjs");
const {createIngressGuard}=require("../lib/input-guard.cjs");
const frame=(user="new-user",text="我 测试甲",chat="group-a")=>({cmd:"aibot_msg_callback",headers:{req_id:"r"},body:{msgid:require("node:crypto").createHash("sha256").update(user+text).digest("hex"),from:{userid:user},chattype:chat?"group":"single",...(chat?{chatid:chat}:{}),msgtype:"text",text:{content:text}}});
function setup(extra={}){const state={},replies=[];let at=100000;const api=createAccessRequests({state,save(){},members:()=>["测试甲","测试乙"],reply:async(_,text)=>replies.push(text),role:"roster",secret:"ExampleBotSecretPlaceholder",port:8799,now:()=>at,...extra});return {state,replies,api,advance:()=>at+=3600001};}
test("only exact small identity text can enter the unauthorized request path",()=>{
  for(const text of ["我 测试甲","我是测试甲","人 测试甲","/as 测试甲","@排班 我 测试甲"])assert.equal(requestName(frame("u",text)),"测试甲");
  for(const text of ["今","我 测试甲; whoami","我 测试甲\n/done 10","/approve u","我 "+"甲".repeat(200)])assert.equal(requestName(frame("u",text)),null);
  assert.equal(requestName({...frame(),body:{...frame().body,msgtype:"mixed"}}),null);
  const {api}=setup(),guard=createIngressGuard({authorized:api.authorized,allowRequest:api.allows});
  assert.equal(guard.check(frame("u","今")).code,"unauthorized");
  assert.equal(guard.check({...frame(),body:{...frame().body,msgtype:"image",image:{url:"https://example.com"}}}).code,"unauthorized");
  const first=guard.check(frame());assert(first.ok);first.release();assert.equal(guard.check(frame()).code,"duplicate");
});
test("request persists without permission; approval binds only the applicant conversation",async()=>{
  const {state,api}=setup();await api.request(frame());assert(!api.authorized("new-user"));assert.equal(state.__schedulePeople,undefined);
  const pending=api.manage("list").requests[0];assert.equal(pending.name,"测试甲");assert.equal(pending.chat,"group-a");
  api.manage("approve "+pending.id);assert(api.authorized("new-user"));assert.equal(state.__schedulePeople[JSON.stringify(["group-a","new-user"])],"测试甲");assert.equal(Object.keys(state.__schedulePeople).length,1);
  assert.throws(()=>api.manage("approve "+pending.id),/已处理/);assert.deepEqual(api.manage("list").requests,[]);
});
test("duplicate requests, expiry, rejection and unique-name conflicts do not grant access",async()=>{
  const {state,api,advance}=setup();await api.request(frame());await api.request(frame());assert.equal(api.manage("list").requests.length,1);
  const first=api.manage("list").requests[0];advance();assert.throws(()=>api.manage("approve "+first.id),/过期/);
  await api.request(frame());const next=api.manage("list").requests[0];api.manage("reject "+next.id);assert(!api.authorized("new-user"));
  state.__schedulePeople={[JSON.stringify(["other-group","owner"])]:"测试甲"};await api.request(frame());assert.equal(api.manage("list").requests.length,0);
  await api.request(frame("another","冒名者"));assert.equal(api.manage("list").requests.length,0);
});
test("name ownership is rechecked at approval, never overwritten by a competing request",async()=>{
  const {api,state}=setup();await api.request(frame("a"));await api.request(frame("b"));const [a,b]=api.manage("list").requests;
  api.manage("approve "+a.id);assert.throws(()=>api.manage("approve "+b.id),/冲突/);assert.deepEqual(state.__operators,["a"]);
});

test("existing worker identities also prevent another account claiming the same name",async()=>{
  const {api}=setup({people:()=>[{user:"existing-worker-user",name:"测试甲"}]});await api.request(frame());
  assert.deepEqual(api.manage("list").requests,[]);assert(!api.authorized("new-user"));
});
test("ticket approval binds the private scope and honors fixed allowlists and persistence failure",async()=>{
  const {api,state}=setup({role:"ticket"});await api.request(frame("u","我 测试甲",null));api.manage("approve "+api.manage("list").requests[0].id);
  assert.equal(api.identity("u","private:u"),"测试甲");assert.equal(api.identity("u","group-a"),"");
  const fixed=setup({allowUsers:["owner"]});await fixed.api.request(frame());assert.equal(fixed.api.manage("list").requests.length,0);
  const failed=setup({save(){throw Error("disk full");}});await assert.rejects(failed.api.request(frame()));assert.equal(failed.state.__accessRequests,undefined);assert(!failed.api.authorized("new-user"));
});
test("pending capacity is bounded and restored requests expire without a timer",async()=>{
  const {api,state}=setup();state.__accessRequests=Object.fromEntries(Array.from({length:20},(_,i)=>[String(i),{id:String(i),user:'u'+i,chat:'g',name:'测试乙',expiresAt:200000}]));
  await api.request(frame());assert.equal(api.manage("list").requests.length,20);assert(!api.authorized("new-user"));
});
test("local approval refuses browser requests, missing secrets, invalid methods and malformed bodies",async()=>{
  const {api}=setup();
  async function call({headers={},text=JSON.stringify({text:"list"}),method="POST"}={}){
    const req=new PassThrough();req.url="/access-requests";req.method=method;req.headers={host:"127.0.0.1:8799","content-type":"application/json",authorization:"Bearer ExampleBotSecretPlaceholder",...headers};
    let status;const result=new Promise(resolve=>{const res={writeHead(value){status=value;},end(body){resolve({status,body:JSON.parse(body)});}};assert(api.local(req,res));});req.end(text);return result;
  }
  assert.equal((await call()).status,200);
  for(const headers of [{authorization:""},{origin:"https://evil.example"},{host:"evil.example:8799"}])assert.equal((await call({headers})).status,403);
  assert.equal((await call({method:"GET"})).status,405);assert.equal((await call({text:'{"text":{}}'})).status,400);
  assert.equal((await call({text:JSON.stringify({text:"approve ../../state"})})).status,409);
});
