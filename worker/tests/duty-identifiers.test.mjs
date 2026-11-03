import test from "node:test";
import assert from "node:assert/strict";
import {normalizeFillCard} from "../src/core/fill-card.mjs";
import {orderIdentifiers, sameBusinessOrder} from "../src/core/order-identity.mjs";
import {buildFeishuTestPrompt} from "../src/core/feishu-test-prompt.mjs";
import {chooseWorkContent} from "../src/platforms/feishu-browser/field-options.mjs";
import {
  validateDutyIdentifiers,
  validateRoomTicketNo,
  validateTransactionNo,
} from "../src/core/duty-identifiers.mjs";

test("事务单号和机房单号接受固定前缀、日期和六位序号", () => {
  assert.equal(validateTransactionNo("SJSW20261026000144"), "");
  assert.equal(validateRoomTicketNo("JF20261026000072"), "");
  assert.deepEqual(validateDutyIdentifiers({
    transactionNo: "SJSW20261001000001",
    roomTicketNo: "JF20261001000002",
  }), []);
});

test("单号前缀、日期、长度或序号不正确时返回具体反馈", () => {
  assert.match(validateTransactionNo("SW20261026000144"), /事务单号格式不正确/);
  assert.match(validateTransactionNo("SJSW20261326000144"), /事务单号格式不正确/);
  assert.match(validateTransactionNo("SJSW2026102600014"), /事务单号格式不正确/);
  assert.match(validateRoomTicketNo("JX20261026000072"), /机房单号格式不正确/);
  assert.match(validateRoomTicketNo("JF20260230000072"), /机房单号格式不正确/);
  assert.match(validateRoomTicketNo(""), /机房单号为空/);
});

test("两个单号同时错误时一次返回两条反馈", () => {
  const errors = validateDutyIdentifiers({
    transactionNo: "SJSW20261026",
    roomTicketNo: "JF20261026",
  });
  assert.equal(errors.length, 2);
});

test("上下架申请号独立校验，保留原序号，不索要另一事务号", () => {
  for (const number of ["SXJXQ20261103000001", "SXJXQ202611030000001", "SXJXQ2026110300000001"]) {
    const card = normalizeFillCard({transactionNo: number, roomTicketNo: "JF20261103000001"});
    assert.equal(card.source, "上下架");
    assert.equal(card.transactionNo, number);
    assert.deepEqual(validateDutyIdentifiers(card), []);
  }
  for (const number of ["SXJXQ20260230000001", "SXJSQ20261103000001", "SXJXQ20261103X1"]) {
    assert.match(validateDutyIdentifiers({source: "上下架", transactionNo: number, roomTicketNo: "JF20261103000001"})[0], /上下架申请单号/);
  }
});

test("明确无上下架申请号只查机房号，模糊编号不当作空值放行", () => {
  const card = normalizeFillCard({source: "上下架", transactionNo: "无", roomTicketNo: "JF20261103000001"});
  assert.equal(card.transactionNo, "");
  assert.deepEqual(validateDutyIdentifiers(card), []);
  assert(sameBusinessOrder(orderIdentifiers(card), orderIdentifiers({transactionNo: "无", roomTicketNo: card.roomTicketNo})));
  assert.equal(validateDutyIdentifiers({source: "上下架", transactionNo: "?", roomTicketNo: card.roomTicketNo}).length, 1);
  assert.equal(validateDutyIdentifiers({source: "上下架", transactionNo: "", roomTicketNo: ""}).length, 1);
  assert.equal(validateDutyIdentifiers({source: "事务工单", transactionNo: "", roomTicketNo: card.roomTicketNo}).length, 1);
});

test("受控识别提示保留上下架来源及模糊编号确认规则", () => {
  const prompt = buildFeishuTestPrompt({message: {images: []}, browserConfig: {}});
  assert.match(prompt, /上下架类型source写上下架/);
  assert.match(prompt, /不另索要SJSW/);
  assert.match(prompt, /已有编号看不清仍须询问/);
  assert.equal(chooseWorkContent({workContent: "设备上下架", specificWork: "陪同厂商设备上架"}, ["无故障进入机房", "上下架相关事项"]), "上下架相关事项");
});
