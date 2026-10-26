import fs from "node:fs";
import path from "node:path";

export class AccessControl {
  constructor({ state, allowUsers = [], rootDir, logger }) {
    this.state = state;
    this.allowUsers = allowUsers;
    this.rootDir = rootDir;
    this.logger = logger;
  }

  #pairingFile() {
    return path.join(this.rootDir, "pairing-code.txt");
  }

  #removePairingFile() {
    try {
      fs.rmSync(this.#pairingFile(), { force: true });
    } catch {}
  }

  #syncPairingFile(code, expiresAt) {
    const expiry = new Date(expiresAt);
    const localExpiry = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).format(expiry);
    fs.writeFileSync(
      this.#pairingFile(),
      `配对码：${code}\n有效至：${localExpiry}\n发送：/pair ${code}\n`,
      "utf8",
    );
  }

  ensurePairingCode() {
    if (this.allowUsers.length) {
      this.#removePairingFile();
      return "";
    }
    const operators = this.state.get("__operators__", []);
    if (operators.length) {
      this.#removePairingFile();
      return "";
    }
    const existing = this.state.get("__pairing__");
    if (existing?.expiresAt > Date.now()) {
      this.#syncPairingFile(existing.code, existing.expiresAt);
      return existing.code;
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Date.now() + 10 * 60 * 1000;
    this.state.set("__pairing__", { code, expiresAt });
    this.#syncPairingFile(code, expiresAt);
    return code;
  }

  createInvite() {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Date.now() + 10 * 60 * 1000;
    this.state.set("__pairing__", { code, expiresAt });
    this.#syncPairingFile(code, expiresAt);
    return code;
  }

  isAuthorized(userId) {
    if (this.allowUsers.length) return this.allowUsers.includes(userId);
    return this.state.get("__operators__", []).includes(userId);
  }

  pair(userId, code) {
    const pending = this.state.get("__pairing__");
    const candidate = String(code || "").match(/\d{6}/)?.[0] || "";
    if (!pending || pending.expiresAt < Date.now() || pending.code !== candidate) {
      if (pending?.expiresAt > Date.now()) {
        this.#syncPairingFile(pending.code, pending.expiresAt);
      } else {
        this.#removePairingFile();
      }
      return { ok: false, message: "配对码错误或已过期，请查看电脑上的 pairing-code.txt" };
    }
    const operators = new Set(this.state.get("__operators__", []));
    operators.add(userId);
    this.state.set("__operators__", [...operators]);
    this.state.delete("__pairing__");
    this.#removePairingFile();
    return { ok: true, message: `配对成功：${userId}` };
  }

  operators() {
    return this.state.get("__operators__", []);
  }

  revoke(userId) {
    const operators = this.state.get("__operators__", []);
    const next = operators.filter((item) => item !== userId);
    this.state.set("__operators__", next);
    return next.length !== operators.length;
  }
}
