import test from "node:test";
import assert from "node:assert/strict";
import { resolveShiftDate } from "../src/core/duty-date.mjs";

test("凌晨工单归入前一日夜班", () => {
  const result = resolveShiftDate(
    "工单 2026-10-24 03:30 至 2026-10-24 05:30",
    "2026-10-24T09:46:00+08:00",
  );
  assert.equal(result.workDate.toISOString().slice(0, 10), "2026-10-24");
  assert.equal(result.shiftDate.toISOString().slice(0, 10), "2026-10-23");
});

test("晚间工单归入当天夜班", () => {
  const result = resolveShiftDate(
    "工单 2026-10-24 19:00 至 2026-10-25 01:00",
    "2026-10-24T16:39:00+08:00",
  );
  assert.equal(result.shiftDate.toISOString().slice(0, 10), "2026-10-24");
});
