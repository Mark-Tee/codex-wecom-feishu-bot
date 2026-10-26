import test from "node:test";
import assert from "node:assert/strict";
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
