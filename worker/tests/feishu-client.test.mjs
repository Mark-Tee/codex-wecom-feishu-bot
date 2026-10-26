import test from "node:test";
import assert from "node:assert/strict";
import { FeishuApiError, FeishuBaseClient } from "../src/legacy/feishu-base/client.mjs";

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

test("飞书令牌复用并分页读取记录", async () => {
  const calls = [];
  const replies = [
    response({ code: 0, tenant_access_token: "token-1", expire: 7200 }),
    response({
      code: 0,
      data: { has_more: true, page_token: "next", items: [{ record_id: "rec-1" }] },
    }),
    response({
      code: 0,
      data: { has_more: false, items: [{ record_id: "rec-2" }] },
    }),
  ];
  const client = new FeishuBaseClient({
    appId: "app",
    appSecret: "secret",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return replies.shift();
    },
  });
  const records = await client.listRecords({ appToken: "base", tableId: "table" });
  assert.deepEqual(records.map((item) => item.record_id), ["rec-1", "rec-2"]);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].options.headers.Authorization, "Bearer token-1");
  assert.equal(calls[1].options.method, "POST");
  assert.match(calls[1].url, /records\/search/);
  assert.match(calls[2].url, /page_token=next/);
});

test("飞书业务错误保留错误码", async () => {
  const client = new FeishuBaseClient({
    appId: "app",
    appSecret: "secret",
    fetchImpl: async () => response({ code: 1254001, msg: "field not found" }, 400),
  });
  await assert.rejects(
    () => client.listFields({ appToken: "base", tableId: "table" }),
    (error) => error instanceof FeishuApiError
      && error.code === 1254001
      && error.message === "field not found",
  );
});

test("附件以 bitable_file 上传并返回 file_token", async () => {
  let uploadRequest;
  const client = new FeishuBaseClient({
    appId: "app",
    appSecret: "secret",
    fetchImpl: async (url, options) => {
      if (url.endsWith("/tenant_access_token/internal")) {
        return response({ code: 0, tenant_access_token: "token-1", expire: 7200 });
      }
      uploadRequest = { url, options };
      return response({ code: 0, data: { file_token: "file-1" } });
    },
    stat: async () => ({ size: 7, isFile: () => true }),
    readFile: async () => Buffer.from("image-1"),
  });
  const token = await client.uploadAttachment("module.jpg", {
    appToken: "base-1",
  });
  assert.equal(token, "file-1");
  assert.match(uploadRequest.url, /drive\/v1\/medias\/upload_all$/);
  assert.equal(uploadRequest.options.body.get("parent_type"), "bitable_file");
  assert.equal(uploadRequest.options.body.get("parent_node"), "base-1");
  assert.equal(uploadRequest.options.body.get("file_name"), "module.jpg");
});

test("删除记录使用明确的 record_id", async () => {
  const calls = [];
  const client = new FeishuBaseClient({
    appId: "app",
    appSecret: "secret",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/tenant_access_token/internal")) {
        return response({ code: 0, tenant_access_token: "token-1" });
      }
      return response({ code: 0, data: {} });
    },
  });
  await client.deleteRecord({ appToken: "base", tableId: "table" }, "rec_123");
  assert.match(calls[1].url, /records\/rec_123$/);
  assert.equal(calls[1].options.method, "DELETE");
});
