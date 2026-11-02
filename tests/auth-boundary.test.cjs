const test=require("node:test"), assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {remoteDenial,remoteUserAuthorized}=require("../lib/remote-policy.cjs");
function fixture(operators=[]) {
 const source=fs.readFileSync(path.join(__dirname,"../bridge.cjs"),"utf8");
 const start=source.indexOf("async function handleText("), guard=source.indexOf("  if (!isOperator)",start), end=source.indexOf("\n  }",guard)+4;
 const state={__operators:operators,__lastChat__:{chatid:"authorized-chat"}};const replies=[];
 const context={state,cfg:{allowUsers:[]},serviceProfile:{role:"combined"},normalizeRosterCommand:x=>x,normalizeTicketCommand:x=>x,stripMentions:x=>x,remoteDenial,remoteUserAuthorized,isDutyReportIntent:()=>false,isMenuPrompt:()=>false,saveState(){},replyText:async(_f,text)=>replies.push(text),log(){},Date};
 vm.createContext(context);vm.runInContext(source.slice(start,end)+"\n return {isOperator};\n}\nglobalThis.handle=handleText;",context);
 return {state,replies,handle:()=>context.handle({body:{msgid:"audit",from:{userid:"unknown"},chatid:"unknown-chat",chattype:"group",text:{content:"explain OSPF"}}})};
}
test("fresh combined deployment denies unknown users",async()=>{const f=fixture();assert.equal(await f.handle(),undefined);assert.equal(f.replies.length,1);assert.equal(f.state.__lastChat__.chatid,"authorized-chat");});
test("rejected user cannot redirect local completion notifications",async()=>{const f=fixture(["authorized"]);await f.handle();assert.equal(f.replies.length,1);assert.equal(f.state.__lastChat__.chatid,"authorized-chat");});

test("old notification state cannot bypass the current whitelist",()=>{
 assert.equal(remoteUserAuthorized("old-user",["current-user"],["old-user"]),false);
 assert.equal(remoteUserAuthorized("",[],[]),false);
 assert.equal(remoteUserAuthorized("paired",[],["paired"]),true);
 const source=fs.readFileSync(path.join(__dirname,"../bridge.cjs"),"utf8");
 assert.match(source,/remoteUserAuthorized\(last.userid, cfg.allowUsers, state.__operators \|\| \[\]\)/);
});
