import test from "node:test";import assert from "node:assert/strict";
import {extractionPolicy,extractionEnvironment} from "../src/runtime/extraction-policy.mjs";
test("extraction has no host tools or business credentials and preserves model auth",()=>{
 let calls=0;const flags=extractionPolicy("codex",{cwd:"D:/test",env:{}},()=>JSON.stringify(++calls===1?[{name:"browser",enabled:true},{name:"shell_helper",enabled:true}]:[]));
 for(const value of ['sandbox_mode="read-only"','web_search="disabled"','mcp_servers.browser.enabled=false','mcp_servers.shell_helper.enabled=false'])assert(flags.includes(value));
 for(const feature of ["shell_tool","view_image","apps","plugins","multi_agent","js_repl","hooks","memories","goals","skill_mcp_dependency_install"])assert.equal(flags[flags.indexOf(feature)-1],"--disable");assert(flags.includes("notify=[]"));assert(flags.includes("project_doc_max_bytes=0"));
 assert.deepEqual(extractionEnvironment({TENCENT_DOCS_TOKEN:"secret",GH_TOKEN:"secret",WECOM_BOT_SECRET:"secret",OPENAI_API_KEY:"model-auth",PATH:"bin"}),{OPENAI_API_KEY:"model-auth",PATH:"bin"});
 for(const response of ['{}','[{"name":"../escape"}]','not json'])assert.throws(()=>extractionPolicy("codex",{},()=>response));
 assert.throws(()=>extractionPolicy("codex",{},()=>JSON.stringify([{name:"browser",enabled:true}])));
});
