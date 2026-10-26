import test from "node:test";
import assert from "node:assert/strict";
import { extractSerialCandidates } from "../src/core/serial-ocr.mjs";

test("优先提取序列号标签附近的值并排除日期", () => {
  const candidates = extractSerialCandidates([
    "HUAWEI",
    "SN: QSFP-2026A001",
    "MODEL: OSFP-400G",
    "20261026",
  ].join("\n"));
  assert.equal(candidates[0].value, "QSFP-2026A001");
  assert.equal(candidates[0].requiresConfirmation, true);
  assert.equal(candidates.some((item) => item.value === "20261026"), false);
});

test("没有序列号标签时仍给候选，但必须人工确认", () => {
  const candidates = extractSerialCandidates("FW12345678\n2.5VDC");
  assert.equal(candidates[0].value, "FW12345678");
  assert.equal(candidates[0].requiresConfirmation, true);
});
