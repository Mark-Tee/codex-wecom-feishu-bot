const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
test("scheduled and Startup launchers use the console-free waiting entry",()=>{
 const root=path.join(__dirname,"..");
 const vbs=fs.readFileSync(path.join(root,"launch-hidden.vbs"),"utf8");
 assert.match(vbs,/shell.Run\(command, 0, True\)/);assert.match(vbs,/WScript.Quit status/);assert.match(vbs,/-Wait/);
 for(const file of ["install-autostart.ps1","install-startup.ps1"]){const text=fs.readFileSync(path.join(root,file),"utf8");assert.match(text,/wscript.exe/);assert.match(text,/launch-hidden.vbs/);}
});
