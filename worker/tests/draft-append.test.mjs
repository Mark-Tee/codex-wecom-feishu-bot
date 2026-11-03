import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {TencentDraftRepository} from "../src/providers/tencent-docs/draft-repository.mjs";
import {parseCsv} from "../src/core/draft-merge.mjs";
import {assertSavedDate} from "../src/platforms/feishu-browser/submission-readback.mjs";

async function fixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "draft-append-"));
  const sheets = ["周报草稿", "交接班草稿"].map((sheet_name, i) => ({sheet_name, sheet_id: String(i), row_count: 20, col_count: 26}));
  const data = sheets.map(() => [{row: 0, col: 0, value_type: "STRING", string_value: "表头"}]);
  const writes = [];
  const client = {
    getSheetInfo: async () => ({sheets}), getCsv: async () => ({csv_data: "表头"}),
    callTool: async (name, args) => {assert.equal(name, "get_cell_data"); return {cells: structuredClone(data[Number(args.sheet_id)])};},
    setCsv: async (file, sheet, csv, row) => {
      writes.push([sheet, row]);
      parseCsv(csv)[0].forEach((v, col) => {if (v !== "") data[Number(sheet)].push({row, col, value_type: "STRING", string_value: v});});
    },
  };
  const repo = new TencentDraftRepository({client, config: {draft: {online_file_id: "fixture"}}, backupDir: root});
  const weekly = Array(17).fill(""); weekly[3] = "测试事项"; weekly[5] = "11.3";
  const handover = Array(9).fill(""); handover[0] = "20261103"; handover[4] = "测试事项";
  try {await run({repo, client, data, writes, spec: {weeklyRows: [weekly], handoverRows: [handover]}, root});}
  finally {await fs.rm(root, {recursive: true, force: true});}
}

test("append respects occupied far columns, zero, false, formulas; retry skips both rows", () => fixture(async ({repo, data, writes, spec}) => {
  data[0].push({row: 1, col: 25, value_type: "NUMBER", number_value: 0}, {row: 2, col: 25, value_type: "BOOL", bool_value: false}, {row: 3, col: 25, formula: '=IF(TRUE,"","")'});
  const before = structuredClone(data);
  const result = await repo.update(spec, {currentDate: "20261103"});
  assert.equal(result.weeklyRows, 1); assert.equal(result.handoverRows, 1);
  assert.deepEqual(writes, [["0", 4], ["1", 1]]);
  assert.deepEqual(data[0].slice(0, before[0].length), before[0]);
  const retry = await repo.update(spec, {currentDate: "20261103"});
  assert.equal(retry.weeklyRows, 0); assert.equal(retry.handoverRows, 0); assert.equal(writes.length, 2);
}));

test("partial success resumes only handover when handover read failed", () => fixture(async ({repo, client, spec, writes}) => {
  const read = client.callTool; let fail = true;
  client.callTool = async (name, args) => {if (args.sheet_id === "1" && fail) throw Error("network"); return read(name, args);};
  await assert.rejects(repo.update(spec), /network/); fail = false;
  await repo.update(spec); assert.deepEqual(writes, [["0", 1], ["1", 1]]);
}));

test("uncertain partial write blocks retry instead of duplicating", () => fixture(async ({repo, client, spec, writes, data}) => {
  client.setCsv = async () => {writes.push("attempt"); data[0].push({row: 1, col: 3, string_value: "partial"}); throw Error("timeout");};
  await assert.rejects(repo.update(spec), /timeout/);
  await assert.rejects(repo.update(spec), /待核验/); assert.equal(writes.length, 1);
}));

test("no room or changing sheet refuses writing", () => fixture(async ({repo, client, data, spec, writes}) => {
  data[0].push({row: 19, col: 25, string_value: "occupied"});
  await assert.rejects(repo.update(spec), /空白/); assert.equal(writes.length, 0);
}));

test("saved date requires exact task and actual timestamp, null never passes", () => {
  const expected = "2026-11-03 06:00", epoch = 1793656800000;
  const snapshot = value => ({complete: true, matchedRecords: [{taskNumber: "TEST001", expectedEnterAt: value}]});
  assert.doesNotThrow(() => assertSavedDate(snapshot(epoch), "TEST001", expected));
  for (const value of [null, undefined, epoch + 60000]) assert.throws(() => assertSavedDate(snapshot(value), "TEST001", expected), /禁止自动重建/);
  assert.throws(() => assertSavedDate(snapshot(epoch), "OTHER", expected));
});

test("another writer changing the table before append stops without writing", () => fixture(async ({repo, client, data, spec, writes}) => {
  const read = client.callTool; let calls = 0;
  client.callTool = async (name, args) => {
    if (++calls === 2) data[0].push({row: 1, col: 25, string_value: "other writer"});
    return read(name, args);
  };
  await assert.rejects(repo.update(spec), /写前草稿变化/);
  assert.equal(writes.length, 0);
}));
