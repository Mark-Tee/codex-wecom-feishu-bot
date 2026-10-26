class WeComLongConnection {
  constructor({
    WebSocketImpl,
    url,
    botId,
    secret,
    ackTimeoutMs = 15000,
    log = () => {},
    parseFrame = (raw) => JSON.parse(raw),
    onFrame = () => {},
    onAuthenticated = () => {},
  }) {
    if (typeof WebSocketImpl !== "function") {
      throw new Error("缺少可用的 WebSocket 实现");
    }
    this.WebSocketImpl = WebSocketImpl;
    this.url = url;
    this.botId = botId;
    this.secret = secret;
    this.ackTimeoutMs = Number(ackTimeoutMs || 15000);
    this.log = log;
    this.parseFrame = parseFrame;
    this.onFrame = onFrame;
    this.onAuthenticated = onAuthenticated;
    this.socket = null;
    this.authenticated = false;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.authFailures = 0;
    this.stopped = false;
    this.ackWaiters = new Map();
    this.sequence = 0;
  }

  requestId(prefix) {
    this.sequence += 1;
    return `${prefix}_${Date.now()}_${this.sequence}_${Math.random().toString(36).slice(2, 8)}`;
  }

  waitAck(requestId, timeoutMs = this.ackTimeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.ackWaiters.delete(requestId);
        reject(new Error(`ack timeout: ${requestId}`));
      }, timeoutMs);
      this.ackWaiters.set(requestId, {
        timer,
        resolve,
        reject,
      });
    });
  }

  async send(cmd, body, requestId) {
    if (!this.socket || this.socket.readyState !== 1) {
      throw new Error("websocket not open");
    }
    const id = requestId || this.requestId(cmd);
    const frame = { cmd, headers: { req_id: id } };
    if (body !== undefined) frame.body = body;
    const ack = this.waitAck(id);
    this.socket.send(JSON.stringify(frame));
    return ack;
  }

  startHeartbeat() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== 1) return;
      const id = this.requestId("ping");
      try {
        this.socket.send(JSON.stringify({ cmd: "ping", headers: { req_id: id } }));
      } catch (error) {
        this.log("ping fail", error.message);
      }
    }, 30000);
  }

  connect() {
    if (this.stopped) return;
    this.log("connecting", this.url, `attempt=${this.reconnectAttempt}`);
    this.socket = new this.WebSocketImpl(this.url);

    if (typeof this.socket.on === "function") {
      this.socket.on("unexpected-response", (_request, response) => {
        this.log(
          "handshake rejected",
          response.statusCode,
          JSON.stringify(response.headers).slice(0, 400),
        );
      });
    }

    this.socket.addEventListener("open", () => {
      this.authenticated = false;
      this.log("ws open, subscribing");
      this.socket.send(JSON.stringify({
        cmd: "aibot_subscribe",
        headers: { req_id: this.requestId("subscribe") },
        body: { bot_id: this.botId, secret: this.secret },
      }));
      this.startHeartbeat();
    });

    this.socket.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : String(event.data);
      const frame = this.parseFrame(raw);
      const id = frame?.headers?.req_id;
      if (id && this.ackWaiters.has(id)) {
        const waiter = this.ackWaiters.get(id);
        clearTimeout(waiter.timer);
        this.ackWaiters.delete(id);
        if (frame.errcode && frame.errcode !== 0) {
          waiter.reject(new Error(`ack errcode ${frame.errcode}: ${frame.errmsg || ""}`));
        } else {
          waiter.resolve(frame);
        }
        return;
      }

      if (!this.authenticated && frame?.errcode !== undefined) {
        if (frame.errcode === 0) {
          this.authenticated = true;
          this.reconnectAttempt = 0;
          this.authFailures = 0;
          this.log("authenticated as", this.botId);
          Promise.resolve(this.onAuthenticated())
            .catch((error) => this.log("authenticated callback error", error.message));
        } else {
          this.authFailures += 1;
          this.log(
            "auth failed",
            frame.errcode,
            frame.errmsg || "",
            `consecutive=${this.authFailures}`,
          );
          try {
            this.socket.close();
          } catch {}
        }
      }
      this.onFrame(frame);
    });

    this.socket.addEventListener("error", (event) => {
      this.log("ws error", (event && event.message) || "unknown");
    });

    this.socket.addEventListener("close", (event) => {
      this.authenticated = false;
      clearInterval(this.heartbeatTimer);
      this.log("ws closed", event.code, event.reason || "");
      this.rejectPending(new Error("websocket closed"));
      if (this.stopped) return;
      this.reconnectAttempt += 1;
      const delay = this.authFailures > 0
        ? Math.min(300000, 10000 * 2 ** Math.min(this.authFailures - 1, 5))
        : Math.min(30000, 1000 * 2 ** Math.min(this.reconnectAttempt, 5));
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    });
  }

  rejectPending(error) {
    for (const waiter of this.ackWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.ackWaiters.clear();
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.reconnectTimer);
    this.rejectPending(new Error("websocket stopped"));
    try {
      this.socket?.close();
    } catch {}
    this.authenticated = false;
  }
}

module.exports = { WeComLongConnection };
