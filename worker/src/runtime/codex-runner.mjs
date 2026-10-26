import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveTencentDocsToken } from "../providers/tencent-docs/client.mjs";
export { extractDutyJson as extractJsonObject } from "./duty-output.mjs";

const DEFAULT_INSTRUCTIONS = [
  "你是企业微信或飞书中的值班助手。",
  "回答简洁、可核验；不要把推断写成事实。",
  "普通问答最多执行 5 条命令。",
  "删除文件前按文件类型和目录规则判断；高风险删除必须确认。",
  "联网查询优先使用当前 Node 可执行文件运行 fetch。",
].join(" ");

export function resolveCodexExecutable(explicit = "") {
  if (explicit && fs.existsSync(explicit)) return explicit;
  const binRoot = path.join(process.env.LOCALAPPDATA || "", "OpenAI", "Codex", "bin");
  const candidates = [];
  try {
    for (const entry of fs.readdirSync(binRoot)) {
      const executable = path.join(binRoot, entry, "codex.exe");
      if (fs.existsSync(executable)) candidates.push(executable);
    }
  } catch {}
  candidates.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  return candidates[0] || "codex";
}

function outputMessages(output) {
  const messages = [];
  let threadId = "";
  for (const line of String(output || "").split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "thread.started" && event.thread_id) threadId = event.thread_id;
      if (
        event.type === "item.completed"
        && event.item?.type === "agent_message"
        && event.item.text
      ) {
        messages.push(event.item.text);
      }
    } catch {}
  }
  return { messages, threadId };
}

export class CodexRunner {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
    this.executable = resolveCodexExecutable(config.runtime.codexExe);
    this.currentProcess = null;
  }

  run({
    prompt,
    threadId = "",
    images = [],
    reasoningEffort = "",
    fastDuty = false,
  }) {
    const args = [];
    const tuning = [];
    if (threadId) {
      args.push("exec", "resume", threadId, "--skip-git-repo-check");
    } else {
      args.push("exec", "-C", this.config.runtime.workdir, "--skip-git-repo-check", "--color", "never");
    }
    if (this.config.duty.enabled) {
      tuning.push("-c", `sandbox_workspace_write.writable_roots=${JSON.stringify([this.config.runtime.specRoot])}`);
    }
    if (reasoningEffort) {
      tuning.push("-c", `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`);
    }
    if (fastDuty) {
      tuning.push("-c", 'model_verbosity="low"', "-c", 'model_reasoning_summary="none"');
    }
    args.push(
      "-c", 'sandbox_mode="workspace-write"',
      "-c", 'approval_policy="never"',
      "-c", "sandbox_workspace_write.network_access=true",
      ...tuning,
      "-c", `developer_instructions=${JSON.stringify(DEFAULT_INSTRUCTIONS)}`,
    );
    for (const image of images) args.push("-i", image);
    args.push("--json", prompt);

    return new Promise((resolve) => {
      const started = Date.now();
      const child = spawn(this.executable, args, {
        cwd: this.config.runtime.workdir,
        windowsHide: true,
        env: this.#environment(),
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.currentProcess = child;
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, this.config.runtime.maxSeconds * 1000);

      child.stdout.on("data", (data) => {
        stdout = (stdout + data.toString("utf8")).slice(-200_000);
      });
      child.stderr.on("data", (data) => {
        stderr = (stderr + data.toString("utf8")).slice(-20_000);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({ ok: false, text: `启动 Codex 失败：${error.message}`, seconds: 0 });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (this.currentProcess === child) this.currentProcess = null;
        const seconds = Math.round((Date.now() - started) / 1000);
        if (timedOut) {
          resolve({ ok: false, text: `任务超时（>${this.config.runtime.maxSeconds}s）`, seconds });
          return;
        }
        if (code !== 0) {
          resolve({ ok: false, text: `Codex 退出码 ${code}\n${(stderr || stdout).slice(-1500)}`, seconds });
          return;
        }
        const parsed = outputMessages(stdout);
        resolve({
          ok: true,
          text: parsed.messages.join("\n\n") || stdout.trim(),
          seconds,
          threadId: parsed.threadId || threadId,
        });
      });
    });
  }

  stop() {
    try {
      this.currentProcess?.kill();
    } catch {}
  }

  #environment() {
    const environment = { ...process.env };
    const token = resolveTencentDocsToken();
    if (token) environment.TENCENT_DOCS_TOKEN = token;
    environment.IDC_DUTY_REPORT_CONFIG = this.config.duty.configPath;
    return environment;
  }
}
