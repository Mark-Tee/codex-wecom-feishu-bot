import fs from "node:fs";
import { spawn } from "node:child_process";
import { CdpConnection, sleep } from "./cdp.mjs";

export { sleep };

async function endpointReady(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(800),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForEndpoint(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await endpointReady(port)) return;
    await sleep(200);
  }
  throw new Error(`Edge 调试端口 ${port} 未就绪`);
}

async function listPages(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) throw new Error(`读取 Edge 页面列表失败：HTTP ${response.status}`);
  return (await response.json()).filter((target) => target.type === "page");
}

async function createPage(port, url) {
  const response = await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,
    { method: "PUT", signal: AbortSignal.timeout(5000) },
  );
  if (!response.ok) throw new Error(`新建 Edge 页面失败：HTTP ${response.status}`);
  return response.json();
}

export class EdgeFormSession {
  static async open(config) {
    const port = Number(config.debugPort || 9223);
    if (!(await endpointReady(port))) {
      if (!config.edgeExecutable || !fs.existsSync(config.edgeExecutable)) {
        throw new Error(`找不到 Edge：${config.edgeExecutable || "未配置 edgeExecutable"}`);
      }
      fs.mkdirSync(config.profileDir, { recursive: true });
      const child = spawn(config.edgeExecutable, [
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${config.profileDir}`,
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--no-first-run",
        "--no-default-browser-check",
        config.formUrl,
      ], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      child.unref();
      await waitForEndpoint(port, Number(config.launchTimeoutMs || 20_000));
    }

    let target = (await listPages(port)).find((page) => (
      page.url?.includes("/base/") && page.webSocketDebuggerUrl
    ));
    if (!target) target = await createPage(port, config.formUrl);
    if (!target?.webSocketDebuggerUrl) throw new Error("Edge 页面没有可用的调试连接");

    const connection = await CdpConnection.connect(target.webSocketDebuggerUrl);
    await connection.send("Runtime.enable");
    await connection.send("Page.enable");
    await connection.send("Page.bringToFront");
    await connection.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await connection.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});
    const currentUrl = String(target.url || "").split("#")[0];
    const desiredUrl = String(config.formUrl || "").split("#")[0];
    const fieldSelectors = Object.values(config.fieldIds || {}).map(
      (fieldId) => `#field-item-${fieldId}`,
    );
    const hasForm = await connection.evaluate(`(() => {
      const hasField = ${JSON.stringify(fieldSelectors)}
        .some((selector) => document.querySelector(selector));
      const hasRecordView = ${JSON.stringify(config.entryMode || "form")} === "record"
        && /待办任务列表/.test(document.body?.innerText || "")
        && /添加记录/.test(document.body?.innerText || "");
      return hasField || hasRecordView;
    })()`);
    if (currentUrl !== desiredUrl) {
      await connection.evaluate(`location.assign(${JSON.stringify(config.formUrl)})`);
    } else if (!hasForm) {
      await connection.evaluate("location.reload()").catch(() => {});
    }
    return new EdgeFormSession(connection, target.id, config.formUrl);
  }

  constructor(connection, targetId, formUrl) {
    this.connection = connection;
    this.targetId = targetId;
    this.formUrl = formUrl;
  }

  evaluate(expression) {
    return this.connection.evaluate(expression);
  }

  click(x, y) {
    return this.connection.click(x, y);
  }

  insertText(text) {
    return this.connection.insertText(text);
  }

  selectAll() {
    return this.connection.selectAll();
  }

  pressBackspace() {
    return this.connection.pressBackspace();
  }

  pressTab() {
    return this.connection.pressTab();
  }

  pressEnter() {
    return this.connection.pressEnter();
  }

  pressEscape() {
    return this.connection.pressEscape();
  }

  close() {
    this.connection.close();
  }
}
