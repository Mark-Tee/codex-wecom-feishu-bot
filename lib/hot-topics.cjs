const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const PLATFORM_NAMES = Object.freeze({
  bili: "B站",
  wb: "微博",
  tieba: "贴吧",
  xhs: "小红书",
  dy: "抖音",
  ks: "快手",
  zhihu: "知乎",
});

const HOT_HELP_FEATURE = Object.freeze({
  id: "hot",
  aliases: ["热点", "舆情", "热搜", "热榜", "抓取", "爬取", "爬虫", "mediacrawler", "热点抓取"],
  usage: [
    "【热点抓取】",
    "触发：热点 <话题>",
    "示例：热点 五险一金",
    "说明：稳定优先，串行抓取 B站/微博/贴吧，每平台 3 帖 × 5 评论、6 秒间隔，约 5-8 分钟。",
    "限制：必须显式启用 features.hotTopics.enabled；中断会记住进度并在重连后自动续跑。",
  ].join("\n"),
});

const HOT_HELP_LINE = "热点 <话题>   —— 可选热点抓取（需显式启用，5-8 分钟，中断可续跑）";

function platformNames(list) {
  return (list || []).map((item) => PLATFORM_NAMES[item] || item).join("、");
}

function walkFiles(dir) {
  const output = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return output;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      output.push(...walkFiles(full));
    } else {
      try {
        const stat = fs.statSync(full);
        output.push({ full, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {}
    }
  }
  return output;
}

function extractHotTopic(prompt) {
  return String(prompt || "")
    .replace(/^\/?hot\s*/i, "")
    .replace(/^热点\s*/, "")
    .trim();
}

function isHotCommand(prompt) {
  return /^(\/hot\b|热点)/.test(String(prompt || ""));
}

function createHotTopics({
  dataRoot,
  enabled = false,
  crawlerDir,
  log,
  replyText,
  send,
  truncate,
  runCodex,
} = {}) {
  if (!dataRoot) throw new Error("hot topics 缺少 dataRoot");
  const crawlerRoot = path.resolve(
    crawlerDir || path.join(dataRoot, "integrations", "MediaCrawler"),
  );
  const crawlerPython = path.join(crawlerRoot, ".venv", "Scripts", "python.exe");
  const jobDir = path.join(dataRoot, "cache", "hot-jobs");
  const jobFile = path.join(jobDir, "current.json");
  fs.mkdirSync(jobDir, { recursive: true });

  function killOrphanBrowsers() {
    try {
      const script = [
        "Get-CimInstance Win32_Process |",
        "Where-Object { $_.Name -in @('chrome.exe','msedge.exe') -and $_.CommandLine -match 'remote-debugging-port=9222|ms-playwright|playwright|--headless' } |",
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ].join(" ");
      execFileSync("powershell", ["-NoProfile", "-Command", script], {
        timeout: 20000,
        windowsHide: true,
      });
    } catch (error) {
      log("kill orphan browsers failed", error.message);
    }
  }

  function saveJob(job) {
    try {
      fs.writeFileSync(jobFile, JSON.stringify(job, null, 2), "utf8");
    } catch {}
  }

  function loadJob() {
    try {
      return JSON.parse(fs.readFileSync(jobFile, "utf8"));
    } catch {
      return null;
    }
  }

  function clearJob() {
    try {
      fs.rmSync(jobFile, { force: true });
    } catch {}
  }

  function runCrawler(platform, topic, timeoutMs = 15 * 60 * 1000) {
    killOrphanBrowsers();
    return new Promise((resolve) => {
      const args = [
        "main.py",
        "--platform", platform,
        "--type", "search",
        "--keywords", topic,
        "--lt", "cookie",
        "--crawler_max_notes_count", "3",
        "--get_comment", "yes",
        "--max_comments_count_singlenotes", "5",
      ];
      const child = spawn(crawlerPython, args, {
        cwd: crawlerRoot,
        env: {
          ...process.env,
          CODEX_QR_PLATFORM: platform,
          CODEX_QR_DIR: path.join(dataRoot, "cache", "qr"),
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let output = "";
      const append = (chunk) => {
        output += chunk.toString("utf8");
        if (output.length > 200000) output = output.slice(-200000);
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      const timer = setTimeout(() => {
        try {
          execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            timeout: 10000,
          });
        } catch {}
        resolve({ ok: false, output: `${output}\n(timeout)` });
      }, timeoutMs);
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({ ok: false, output: error.message });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ ok: code === 0, output });
      });
    });
  }

  function collectDigest(sinceMs = 0, maxChars = 6000) {
    const base = path.join(crawlerRoot, "data");
    let files = [];
    try {
      files = fs.readdirSync(base, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((entry) => {
          const output = [];
          const visit = (dir) => {
            let entries = [];
            try {
              entries = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
              return;
            }
            for (const child of entries) {
              const full = path.join(dir, child.name);
              if (child.isDirectory()) visit(full);
              else if (/search_(contents|comments).*\.(json|jsonl)$/i.test(child.name)) {
                output.push(full);
              }
            }
          };
          visit(path.join(base, entry.name));
          return output;
        })
        .filter((full) => sinceMs <= 0 || fs.statSync(full).mtimeMs >= sinceMs)
        .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
    } catch {}

    const chunks = [];
    let used = 0;
    let items = 0;
    for (const file of files.slice(0, 14)) {
      let text = "";
      try {
        text = fs.readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const pieces = [];
      for (const match of text.matchAll(/"(?:title|content|text|desc|comment_text)"\s*:\s*"([^"]{4,300})"/g)) {
        pieces.push(match[1]);
        items += 1;
        if (pieces.join(" ").length > 600) break;
      }
      const block = `【${path.basename(file)}】\n${pieces.join("\n")}`;
      if (used + block.length > maxChars) break;
      chunks.push(block);
      used += block.length;
    }
    return { text: chunks.join("\n\n"), files: files.length, items };
  }

  async function sendChatMessage(chatid, chatType, text) {
    if (!chatid) return;
    await send("aibot_send_msg", {
      chatid,
      chat_type: chatType || 1,
      msgtype: "markdown",
      markdown: { content: truncate(text) },
    });
  }

  async function runJob(job, notify, reply) {
    const remaining = job.platforms.filter((platform) => !job.done.includes(platform));
    for (const platform of remaining) {
      const name = PLATFORM_NAMES[platform] || platform;
      await notify(`开始抓取【${name}】。已完成：${platformNames(job.done) || "无"}。`).catch(() => {});
      const result = await runCrawler(platform, job.topic, 240000);
      if (result.ok) {
        job.done.push(platform);
        saveJob(job);
        await notify(`【${name}】完成。当前已完成：${platformNames(job.done)}`).catch(() => {});
      } else {
        log("crawl failed", platform, String(result.output || "").slice(-300).replace(/\s+/g, " "));
        await notify(`【${name}】没有跑完，稍后继续。已完成：${platformNames(job.done) || "无"}`).catch(() => {});
      }
    }

    const partial = [];
    for (const platform of job.platforms) {
      if (job.done.includes(platform)) continue;
      const fresh = walkFiles(path.join(crawlerRoot, "data", platform))
        .filter((file) => file.mtimeMs >= job.createdAt - 2000);
      if (fresh.length) {
        job.done.push(platform);
        partial.push(PLATFORM_NAMES[platform] || platform);
        saveJob(job);
      }
    }
    if (partial.length) {
      await notify(`部分完成：${partial.join("、")}（数据可能不完整，已纳入汇总）。`).catch(() => {});
    }

    const digest = collectDigest(job.createdAt);
    if (!digest.text) {
      await notify("抓取结束，但没有读到有效内容。可能是登录失效或平台限制。").catch(() => {});
      clearJob();
      return;
    }
    await notify("抓取完成，正在汇总观点…").catch(() => {});
    const summaryPrompt = [
      `下面是从 ${platformNames(job.done)} 抓取到的关于「${job.topic}」的标题与评论片段。`,
      "请用中文总结当下人们的看法，按支持/反对/中立/主要关切分类，",
      "每类给出观点概述和 1-2 条代表性原话（注明来源文件名），最后给出样本量说明。",
      `样本：${digest.files} 个数据文件，约 ${digest.items} 条标题/评论。未完成平台已注明。`,
      "请控制在 600 字以内，先给结论再给依据。",
      "不要编造未出现的内容；结论仅代表此样本范围。",
      digest.text,
    ].join("\n\n");
    const result = await runCodex(summaryPrompt);
    await (reply || notify)(result.text || "(汇总失败)").catch(() => {});
    clearJob();
    killOrphanBrowsers();
    log("hot done", job.topic, platformNames(job.done));
  }

  async function handleHot(frame, prompt, userId) {
    const topic = extractHotTopic(prompt);
    if (!topic) {
      await replyText(frame, "用法：热点 <话题>").catch(() => {});
      return;
    }
    const platforms = ["bili", "wb", "tieba"];
    const body = frame.body || {};
    const job = {
      topic,
      platforms,
      done: [],
      chatid: body.chatid || userId,
      chatType: body.chattype === "group" ? 2 : 1,
      createdAt: Date.now(),
    };
    saveJob(job);
    await replyText(
      frame,
      [
        `开始抓取「${topic}」`,
        `稳定优先：串行抓取 ${platformNames(platforms)}，每平台 3 帖 × 5 评论，请求间隔约 6 秒，预计 5-8 分钟。`,
        "如果中途断开，我会记住进度，恢复后接着跑。",
      ].join("\n"),
    ).catch(() => {});
    const notify = (text) => replyText(frame, text);
    await runJob(job, notify, notify);
  }

  async function resumeHotJob() {
    if (!enabled) return;
    const job = loadJob();
    if (!job) return;
    const remaining = (job.platforms || [])
      .filter((platform) => !(job.done || []).includes(platform));
    if (!remaining.length) {
      clearJob();
      return;
    }
    log("resume hot job", job.topic, remaining.join(","));
    try {
      await sendChatMessage(
        job.chatid,
        job.chatType,
        `上次「${job.topic}」已完成：${platformNames(job.done) || "无"}；还剩：${platformNames(remaining)}。我接着跑，不用你重新发。`,
      );
    } catch (error) {
      log("resume notify failed", error.message);
    }
    await runJob(
      job,
      (text) => sendChatMessage(job.chatid, job.chatType, text),
      (text) => sendChatMessage(job.chatid, job.chatType, text),
    );
  }

  function cleanup(now = Date.now()) {
    if (!enabled) return { removed: 0, freed: 0 };
    let removed = 0;
    let freed = 0;
    const maxBytes = 500 * 1024 * 1024;
    const files = walkFiles(path.join(crawlerRoot, "data"));
    for (const file of files) {
      if (now - file.mtimeMs <= 7 * 24 * 3600 * 1000) continue;
      try {
        fs.rmSync(file.full, { force: true });
        removed += 1;
        freed += file.size;
      } catch {}
    }
    let total = walkFiles(path.join(crawlerRoot, "data"))
      .reduce((sum, file) => sum + file.size, 0);
    for (const file of walkFiles(path.join(crawlerRoot, "data"))
      .sort((left, right) => left.mtimeMs - right.mtimeMs)) {
      if (total <= maxBytes) break;
      try {
        fs.rmSync(file.full, { force: true });
        total -= file.size;
        removed += 1;
        freed += file.size;
      } catch {}
    }
    return { removed, freed };
  }

  return {
    clearJob,
    cleanup,
    enabled,
    handleHot,
    resumeHotJob,
  };
}

module.exports = {
  HOT_HELP_FEATURE,
  HOT_HELP_LINE,
  PLATFORM_NAMES,
  createHotTopics,
  extractHotTopic,
  isHotCommand,
  platformNames,
  walkFiles,
};
