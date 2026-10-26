import test from "node:test";
import assert from "node:assert/strict";
import {
  clickVisibleTextScript,
  datePickerVisibleScript,
  dateTimeInputValuesScript,
  dropdownRectScript,
  fieldElementPointScript,
  fieldContainsValueScript,
  fieldSelector,
  openPersonSelectorScript,
  optionRectScript,
  personOptionRectScript,
  pickerCellPointScript,
  pickerHeaderButtonPointScript,
  pickerHeaderTextsScript,
  visibleButtonPointScript,
  visibleElementScript,
} from "../src/platforms/feishu-browser/dom-scripts.mjs";
import { normalizeOption } from "../src/platforms/feishu-browser/field-options.mjs";
import {
  parseBitableTarget,
  readTaskNumbers,
} from "../src/platforms/feishu-browser/task-list-reader.mjs";

test("飞书 DOM 脚本可编译且字段选择器受控", () => {
  const scripts = [
    visibleElementScript("#field-item-fldExample"),
    optionRectScript("事务工单"),
    dropdownRectScript("#field-item-fldExample"),
    personOptionRectScript("#field-item-fldExample", "测试甲"),
    openPersonSelectorScript("#field-item-fldExample"),
    clickVisibleTextScript("添加记录"),
    fieldContainsValueScript("#field-item-fldExample", "测试甲"),
    fieldElementPointScript("#field-item-fldExample", "input"),
    pickerHeaderTextsScript("#field-item-fldExample"),
    pickerHeaderButtonPointScript("#field-item-fldExample", "/^\\\\d{4}年$/"),
    pickerCellPointScript("#field-item-fldExample", "26"),
    dateTimeInputValuesScript("#field-item-fldExample"),
    datePickerVisibleScript("#field-item-fldExample"),
    visibleButtonPointScript("提交"),
  ];
  for (const script of scripts) {
    assert.doesNotThrow(() => new Function(script));
  }
  assert.match(clickVisibleTextScript("添加记录"), /aria-label/);
  assert.equal(fieldSelector("fldExample", "record"), '.base_record_card_field_editor_wrapper:has(> label[data-field-id="fldExample"])');
  assert.equal(fieldSelector("fldExample", "form"), "#field-item-fldExample");
  assert.throws(() => fieldSelector("bad selector"), /无效的飞书字段 ID/);
  assert.equal(normalizeOption(" 测试 机房 "), "测试机房");
});

test("任务号读取按分页合并当前前缀", async () => {
  const pages = [
    { values: ["WD20261026001"], loaded: 2, total: 3 },
    { values: ["WD20261026002"], loaded: 1, total: 3 },
  ];
  let calls = 0;
  const session = {
    async evaluate() {
      calls += 1;
      return pages.shift();
    },
  };
  const numbers = await readTaskNumbers(session, {
    formUrl: "https://example.feishu.cn/base/appToken123?table=tblTable123",
    viewId: "vewAllTasks",
    fieldId: "fldTaskList",
    pageSize: 2,
  }, "WD20261026");
  assert.equal(calls, 2);
  assert.deepEqual(numbers, ["WD20261026001", "WD20261026002"]);
});

test("飞书多维表格地址解析缺少 table 时失败", () => {
  assert.deepEqual(
    parseBitableTarget("https://example.feishu.cn/base/appToken123?table=tblTable123"),
    {
      origin: "https://example.feishu.cn",
      appToken: "appToken123",
      tableId: "tblTable123",
    },
  );
  assert.throws(
    () => parseBitableTarget("https://example.feishu.cn/base/appToken123"),
    /缺少 app token 或 table ID/,
  );
});
