#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const {spawn} = require("node:child_process");
const {createSupervisor} = require("./lib/bot-supervisor.cjs");
const {appendRotatingLog} = require("./lib/rotating-log.cjs");
const ROOT = __dirname;
const {readServiceProfile}=require("./lib/service-profile.cjs");
const profile=readServiceProfile(ROOT);
const LOG_DIR = path.join(ROOT,"logs");
const serviceId = crypto.createHash("sha256").update(ROOT).digest("hex");
function log(message) {
  try { appendRotatingLog(path.join(LOG_DIR,"watchdog.log"), `[${new Date().toISOString()}] ${message}\n`, {maxBytes:1024*1024,keep:5}); } catch {}
}
async function probe() {
  const response = await fetch(`http://127.0.0.1:${profile.healthPort}/health`, {signal:AbortSignal.timeout(5000)});
  if (!response.ok) throw new Error("health unavailable");
  const data = await response.json();
  if(data.service !== "codex-wecom-bridge" || !Number.isInteger(data.pid)) throw new Error("different service");
  return data;
}
const lock = net.createServer((socket) => socket.end());
let supervisor, timer;
lock.on("error", (error) => {
  log(error.code === "EADDRINUSE" ? "已有守护或端口占用，本守护退出" : "守护启动失败");
  process.exit(error.code === "EADDRINUSE" ? 0 : 1);
});
lock.listen({port:profile.guardianPort,host:"127.0.0.1",exclusive:true}, async () => {
  // Recover a surviving child after guardian failure; match this exact checkout, never an unknown bot.
  let existing;
  try { existing = await probe(); } catch {}
  if (existing) {
    if (existing.serviceId !== serviceId) {log("端口属于其他项目，不接管、不结束该进程"); lock.close(); return;}
    while (existing?.busy) {
      log("等待本项目现有工单结束后接管遗留进程");
      await new Promise((resolve) => setTimeout(resolve,30_000));
      try { existing = await probe(); } catch {existing = null;}
      if(existing && existing.serviceId !== serviceId) {lock.close(); return;}
    }
    if(existing) {
      const confirmed = await probe();
      if(confirmed.pid !== existing.pid || confirmed.serviceId !== serviceId || confirmed.busy) {lock.close(); return;}
      log("接管本项目遗留主进程，回收后由单一守护恢复");
      try {process.kill(confirmed.pid);} catch (error) {if(error.code !== "ESRCH") throw error;}
      await new Promise((resolve) => setTimeout(resolve,1000));
    }
  }
  supervisor = createSupervisor({probe, log, spawnBridge:() => {
    const child = spawn(process.execPath,[path.join(ROOT,profile.entry)],{cwd:ROOT,stdio:["ignore","pipe","pipe"],windowsHide:true,env:process.env});
    for(const [stream,name] of [[child.stdout,"bridge-stdout.log"],[child.stderr,"bridge-stderr.log"]]) {
      stream.on("data", (data) => {try {appendRotatingLog(path.join(LOG_DIR,name),data);} catch {}});
    }
    return child;
  }});
  supervisor.launch();
  timer = setInterval(() => supervisor.check().catch(() => log("健康检查失败，下次继续")),30_000);
  log(`守护已启动 pid=${process.pid}；仅检查本机，不调用模型`);
});
function stop() { clearInterval(timer); supervisor?.stop(); lock.close(); process.exit(0); }
process.on("SIGINT",stop);process.on("SIGTERM",stop);
