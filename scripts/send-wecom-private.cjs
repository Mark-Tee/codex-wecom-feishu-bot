#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { WeComLongConnection } = require("../lib/wecom-long-connection.cjs");

const WS_URL = "wss://openws.work.weixin.qq.com";

function argument(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

function resolveWebSocket() {
  try {
    return require("ws");
  } catch {}
  try {
    return require(path.join(__dirname, "..", "vendor", "ws"));
  } catch {}
  return globalThis.WebSocket;
}

function truncateUtf8(value, maxBytes = 20000) {
  const buffer = Buffer.from(String(value || ""), "utf8");
  if (buffer.length <= maxBytes) return buffer.toString("utf8");
  return buffer.subarray(0, maxBytes).toString("utf8") + "\n\n…（内容过长，已截断）";
}

async function main() {
  const configPath = path.resolve(argument("config"));
  const chatId = String(argument("user")).trim();
  const messageFile = path.resolve(argument("message-file"));
  if (!fs.existsSync(configPath)) throw new Error("配置文件不存在");
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(chatId)) {
    throw new Error("单聊 userid 格式不正确");
  }
  if (!fs.existsSync(messageFile)) throw new Error("消息文件不存在");

  const config = JSON.parse(
    fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""),
  );
  if (!config.botId || !config.secret) {
    throw new Error("配置缺少 botId 或 secret");
  }
  const message = truncateUtf8(fs.readFileSync(messageFile, "utf8").trim());
  if (!message) throw new Error("消息为空");

  let resolveAuthenticated;
  let rejectAuthenticated;
  const authenticated = new Promise((resolve, reject) => {
    resolveAuthenticated = resolve;
    rejectAuthenticated = reject;
  });
  const connection = new WeComLongConnection({
    WebSocketImpl: resolveWebSocket(),
    url: WS_URL,
    botId: config.botId,
    secret: config.secret,
    log: () => {},
    onAuthenticated: resolveAuthenticated,
  });

  const timeout = setTimeout(() => {
    rejectAuthenticated(new Error("企业微信长连接认证超时"));
    connection.stop();
  }, 30000);
  try {
    connection.start();
    await authenticated;
    const ack = await connection.send("aibot_send_msg", {
      chatid: chatId,
      chat_type: 1,
      msgtype: "markdown",
      markdown: { content: message },
    });
    if (ack.errcode && ack.errcode !== 0) {
      throw new Error(`主动私发失败：${ack.errcode} ${ack.errmsg || ""}`.trim());
    }
    process.stdout.write(JSON.stringify({
      ok: true,
      recipient: chatId,
      chatType: "single",
      bytes: Buffer.byteLength(message, "utf8"),
    }, null, 2));
  } finally {
    clearTimeout(timeout);
    connection.stop();
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
