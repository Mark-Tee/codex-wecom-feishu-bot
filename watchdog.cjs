#!/usr/bin/env node
/**
 * 桥接守护进程：以子进程方式运行 bridge.cjs，退出后自动重启。
 * 用 WMI 或启动文件夹拉起本文件即可，bridge 自身不需要再单独启动。
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const LOG_DIR = path.join(ROOT, "logs");
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, "watchdog.log");
const PID_FILE = path.join(ROOT, "watchdog.pid");

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 2 * 1024 * 1024) {
      fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
    }
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {}
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// 单实例：已有守护在跑就直接退出
if (fs.existsSync(PID_FILE)) {
  const old = Number(fs.readFileSync(PID_FILE, "utf8").trim());
  if (old && old !== process.pid && alive(old)) {
    console.log("watchdog already running:", old);
    process.exit(0);
  }
}
fs.writeFileSync(PID_FILE, String(process.pid), "utf8");
log(`watchdog started pid=${process.pid}`);

let child = null;
let stopped = false;

function startBridge() {
  if (stopped) return;
  log("starting bridge");
  child = spawn(process.execPath, [path.join(ROOT, "bridge.cjs")], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: process.env,
  });
  child.stdout.on("data", (d) => process.stdout.write(d));
  child.stderr.on("data", (d) => process.stderr.write(d));
  child.on("exit", (code, signal) => {
    log(`bridge exited code=${code} signal=${signal || ""}; restarting in 5s`);
    child = null;
    setTimeout(startBridge, 5000);
  });
}

function shutdown() {
  stopped = true;
  log("watchdog stopping");
  try {
    child && child.kill();
  } catch {}
  try {
    fs.rmSync(PID_FILE, { force: true });
  } catch {}
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
startBridge();
