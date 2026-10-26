import path from "node:path";
import { loadConfig, loadDutyConfig } from "../config.mjs";
import { StateStore } from "../state-store.mjs";
import { ConversationService } from "../runtime/conversation-service.mjs";
import { CodexRunner } from "../runtime/codex-runner.mjs";
import { TencentDocsClient } from "../providers/tencent-docs/client.mjs";
import { TencentDraftRepository } from "../providers/tencent-docs/draft-repository.mjs";
import { FeishuBrowserFormFiller } from "../platforms/feishu-browser/form-filler.mjs";

function configPathFromArgs() {
  const index = process.argv.indexOf("--config");
  return path.resolve(index >= 0 ? process.argv[index + 1] : "config.json");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function logger(level) {
  return (...parts) => {
    process.stderr.write(`[${level}] ${parts.join(" ")}\n`);
  };
}

async function main() {
  const message = JSON.parse(await readStdin());
  const config = loadConfig(configPathFromArgs());
  const dutyConfig = loadDutyConfig(config);
  const state = new StateStore(path.resolve("state.json"));
  const docsClient = new TencentDocsClient();
  const draftRepository = new TencentDraftRepository({
    client: docsClient,
    config: dutyConfig,
  });
  const log = {
    info: logger("info"),
    warn: logger("warn"),
    error: logger("error"),
  };
  const runner = new CodexRunner({ config, logger: log });
  const browserFiller = new FeishuBrowserFormFiller({
    config: config.feishuBrowser,
    logger: log,
  });
  const service = new ConversationService({
    config,
    dutyConfig,
    runner,
    docsClient,
    draftRepository,
    state,
    access: { isAuthorized: () => true },
    logger: log,
    browserFiller,
  });
  const replies = [];
  const responder = {
    replyText: async (text) => { replies.push({ kind: "text", text }); },
    replyProgress: async (_id, text, final = false) => {
      replies.push({ kind: final ? "final" : "progress", text });
    },
  };

  await service.handle(message, responder);
  const deadline = Date.now() + Number(process.env.DUTY_WORKER_TIMEOUT_MS || 180_000);
  while ((service.queue.running || service.queue.size > 0) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (service.queue.running || service.queue.size > 0) {
    throw new Error("值班任务处理超时");
  }
  process.stdout.write(JSON.stringify({ replies }, null, 2));
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
