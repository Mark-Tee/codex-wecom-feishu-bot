function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class CdpConnection {
  static async connect(webSocketUrl, { timeoutMs = 10_000 } = {}) {
    if (typeof WebSocket === "undefined") {
      throw new Error("当前 Node.js 不支持 WebSocket，请使用 Node.js 22+");
    }
    const socket = new WebSocket(webSocketUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("连接 Edge 调试端口超时")), timeoutMs);
      socket.addEventListener("open", () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("无法连接 Edge 调试端口"));
      }, { once: true });
    });
    return new CdpConnection(socket);
  }

  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      let payload;
      try {
        payload = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!payload.id || !this.pending.has(payload.id)) return;
      const { resolve, reject, timer } = this.pending.get(payload.id);
      this.pending.delete(payload.id);
      clearTimeout(timer);
      if (payload.error) reject(new Error(payload.error.message || "Edge 调试命令失败"));
      else resolve(payload.result || {});
    });
    socket.addEventListener("close", () => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error("Edge 调试连接已关闭"));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}, { timeoutMs = 15_000 } = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Edge 调试命令超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || "页面脚本执行失败");
    }
    return result.result?.value;
  }

  async click(x, y) {
    const point = { x: Math.round(x), y: Math.round(y), button: "left", clickCount: 1 };
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point });
  }

  async insertText(text) {
    await this.send("Input.insertText", { text: String(text) });
  }

  async pressTab() {
    await this.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
    });
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
    });
  }

  async pressEnter() {
    await this.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
  }

  async pressEscape() {
    await this.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
  }

  async pressBackspace() {
    await this.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Backspace",
      code: "Backspace",
      windowsVirtualKeyCode: 8,
    });
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Backspace",
      code: "Backspace",
      windowsVirtualKeyCode: 8,
    });
  }

  async selectAll() {
    await this.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      modifiers: 2,
    });
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      modifiers: 2,
    });
  }

  close() {
    try {
      this.socket.close();
    } catch {}
  }
}

export { sleep };
