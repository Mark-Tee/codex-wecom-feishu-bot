import fs from "node:fs";
import path from "node:path";

function assertRequired(value, label) {
  if (!value) throw new Error(`飞书配置缺少：${label}`);
}

const MAX_SINGLE_UPLOAD_BYTES = 20 * 1024 * 1024;

function mimeTypeFor(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".heic") return "image/heic";
  return "image/jpeg";
}

export class FeishuApiError extends Error {
  constructor(message, { status = 0, code = 0 } = {}) {
    super(message);
    this.name = "FeishuApiError";
    this.status = status;
    this.code = code;
  }
}

export class FeishuBaseClient {
  constructor({
    appId,
    appSecret,
    baseUrl = "https://open.feishu.cn",
    fetchImpl = globalThis.fetch,
    timeoutMs = 15_000,
    uploadTimeoutMs = 60_000,
    now = Date.now,
    readFile = fs.promises.readFile,
    stat = fs.promises.stat,
  }) {
    assertRequired(appId, "appId");
    assertRequired(appSecret, "appSecret");
    assertRequired(fetchImpl, "fetch");
    this.appId = appId;
    this.appSecret = appSecret;
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.uploadTimeoutMs = uploadTimeoutMs;
    this.now = now;
    this.readFile = readFile;
    this.stat = stat;
    this.token = "";
    this.tokenExpiresAt = 0;
    this.tokenPromise = null;
  }

  async #request(path, { method = "GET", body, authenticated = true } = {}) {
    const headers = { "Content-Type": "application/json; charset=utf-8" };
    if (authenticated) headers.Authorization = `Bearer ${await this.#accessToken()}`;
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new FeishuApiError(`飞书返回了无法解析的响应（HTTP ${response.status}）`, {
        status: response.status,
      });
    }
    if (!response.ok || payload.code !== 0) {
      throw new FeishuApiError(
        payload.msg || `飞书请求失败（HTTP ${response.status}）`,
        { status: response.status, code: payload.code || 0 },
      );
    }
    return payload;
  }

  async #accessToken() {
    if (this.token && this.tokenExpiresAt > this.now()) return this.token;
    if (this.tokenPromise) return this.tokenPromise;
    this.tokenPromise = (async () => {
      const payload = await this.#request(
        "/open-apis/auth/v3/tenant_access_token/internal",
        {
          method: "POST",
          authenticated: false,
          body: { app_id: this.appId, app_secret: this.appSecret },
        },
      );
      const token = payload.tenant_access_token || payload.data?.tenant_access_token;
      const expiresIn = Number(payload.expire || payload.data?.expire || 7200);
      if (!token) throw new FeishuApiError("飞书没有返回 tenant_access_token");
      this.token = token;
      this.tokenExpiresAt = this.now() + Math.max(60, expiresIn - 60) * 1000;
      return token;
    })();
    try {
      return await this.tokenPromise;
    } finally {
      this.tokenPromise = null;
    }
  }

  async warmToken() {
    return this.#accessToken();
  }

  async listRecords(tableId, {
    pageSize = 500,
    maxPages = 100,
    viewId,
    fieldNames,
    filter,
    sort,
    automaticFields,
  } = {}) {
    const records = [];
    let pageToken = "";
    for (let page = 0; page < maxPages; page += 1) {
      const query = new URLSearchParams({ page_size: String(pageSize) });
      if (pageToken) query.set("page_token", pageToken);
      const body = {};
      if (viewId) body.view_id = viewId;
      if (fieldNames) body.field_names = fieldNames;
      if (filter) body.filter = filter;
      if (sort) body.sort = sort;
      if (automaticFields != null) body.automatic_fields = automaticFields;
      const payload = await this.#request(
        `/open-apis/bitable/v1/apps/${encodeURIComponent(tableId.appToken)}`
        + `/tables/${encodeURIComponent(tableId.tableId)}/records/search?${query}`,
        { method: "POST", body },
      );
      records.push(...(payload.data?.items || []));
      if (!payload.data?.has_more || !payload.data?.page_token) break;
      pageToken = payload.data.page_token;
    }
    return records;
  }

  async listFields(tableId) {
    const payload = await this.#request(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(tableId.appToken)}`
      + `/tables/${encodeURIComponent(tableId.tableId)}/fields?page_size=100`,
    );
    return payload.data?.items || [];
  }

  async createRecord(tableId, fields) {
    const payload = await this.#request(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(tableId.appToken)}`
      + `/tables/${encodeURIComponent(tableId.tableId)}/records`,
      { method: "POST", body: { fields } },
    );
    return payload.data?.record;
  }

  async updateRecord(tableId, recordId, fields) {
    const payload = await this.#request(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(tableId.appToken)}`
      + `/tables/${encodeURIComponent(tableId.tableId)}/records/${encodeURIComponent(recordId)}`,
      { method: "PUT", body: { fields } },
    );
    return payload.data?.record;
  }

  async deleteRecord(tableId, recordId) {
    await this.#request(
      `/open-apis/bitable/v1/apps/${encodeURIComponent(tableId.appToken)}`
      + `/tables/${encodeURIComponent(tableId.tableId)}/records/${encodeURIComponent(recordId)}`,
      { method: "DELETE" },
    );
    return true;
  }

  async uploadAttachment(filePath, { appToken, fileName = path.basename(filePath) }) {
    assertRequired(appToken, "appToken");
    const fileStat = await this.stat(filePath);
    if (!fileStat.isFile()) throw new Error(`附件不是文件：${filePath}`);
    if (fileStat.size > MAX_SINGLE_UPLOAD_BYTES) {
      throw new Error("单个飞书附件不能超过 20MB");
    }
    const content = await this.readFile(filePath);
    const form = new FormData();
    form.set("file_name", fileName);
    form.set("parent_type", "bitable_file");
    form.set("parent_node", appToken);
    form.set("size", String(fileStat.size));
    form.set("file", new Blob([content], { type: mimeTypeFor(fileName) }), fileName);
    const response = await this.fetchImpl(
      `${this.baseUrl}/open-apis/drive/v1/medias/upload_all`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${await this.#accessToken()}` },
        body: form,
        signal: AbortSignal.timeout(this.uploadTimeoutMs),
      },
    );
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new FeishuApiError(`飞书返回了无法解析的附件响应（HTTP ${response.status}）`, {
        status: response.status,
      });
    }
    if (!response.ok || payload.code !== 0 || !payload.data?.file_token) {
      throw new FeishuApiError(
        payload.msg || `飞书附件上传失败（HTTP ${response.status}）`,
        { status: response.status, code: payload.code || 0 },
      );
    }
    return payload.data.file_token;
  }
}
