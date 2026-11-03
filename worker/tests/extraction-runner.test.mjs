import test from "node:test";import assert from "node:assert/strict";import fs from "node:fs";import path from "node:path";import os from "node:os";
import {CodexRunner} from "../src/runtime/codex-runner.mjs";
test("actual runner spawn preserves the extraction boundary and treats option-like text as data",async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"extraction-spawn-")),probe=path.join(root,"probe.cjs"),record=path.join(root,"argv.json");
 fs.writeFileSync(probe,`if(require("node:path").basename(process.argv[1])==="mcp"){console.log("[]");process.exit(0);}require("node:fs").writeFileSync(${JSON.stringify(record)},JSON.stringify({args:process.argv.slice(1),envKeys:Object.keys(process.env)}));console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"{}"}}));process.exit(0);`);
 const original=process.env.NODE_OPTIONS,token=process.env.TENCENT_DOCS_TOKEN;process.env.NODE_OPTIONS='--require "'+probe.replaceAll('\\','/')+'"';process.env.TENCENT_DOCS_TOKEN="ExampleToken";
 try{
  const runner=new CodexRunner({config:{runtime:{codexExe:process.execPath,workdir:root,specRoot:root,maxSeconds:5},duty:{enabled:true}},logger:{}});
  const result=await runner.run({prompt:"--dangerously-bypass-approvals-and-sandbox",fastDuty:true});assert(result.ok);
  const captured=JSON.parse(fs.readFileSync(record,"utf8"));assert.deepEqual(captured.args.slice(-3),["--json","--","--dangerously-bypass-approvals-and-sandbox"]);assert(captured.args.includes('sandbox_mode="read-only"'));assert(!captured.args.includes('sandbox_mode="workspace-write"'));assert(!captured.envKeys.includes("TENCENT_DOCS_TOKEN"));assert(captured.args.includes("notify=[]"));
 }finally{if(original===undefined)delete process.env.NODE_OPTIONS;else process.env.NODE_OPTIONS=original;if(token===undefined)delete process.env.TENCENT_DOCS_TOKEN;else process.env.TENCENT_DOCS_TOKEN=token;}
});
