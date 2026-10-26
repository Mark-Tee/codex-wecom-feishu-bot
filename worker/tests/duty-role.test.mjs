import test from "node:test";
import assert from "node:assert/strict";
import { classifyRole } from "../src/core/duty-role.mjs";

const config = {
  operator_name: "张明",
  line: {
    aux_column_header: "网络辅值",
    team_members: ["张明", "王爽", "李俊"],
  },
  schedule: {
    primary_white_value: "白班",
    primary_night_value: "夜班",
    primary_white_fill: "FFFF00",
    primary_night_fill: "B4C6E7",
  },
};
const headers = ["日期", "张明", "王爽", "网络辅值"];

test("法定节假日黄色白班为加班主值", () => {
  const role = classifyRole({
    row: ["20261004", "白班", "", ""],
    styles: [
      { col: 0, background_color: "FF92D050" },
      { col: 1, background_color: "FFFFFF00" },
    ],
    headers,
    config,
  });
  assert.equal(role.role, "white_primary");
  assert.equal(role.overtime, true);
});

test("普通白底白班且不在辅值列为其他角色", () => {
  const role = classifyRole({
    row: ["20261008", "白班", "", "王爽"],
    styles: [
      { col: 0, background_color: "FFFFFFFF" },
      { col: 1, background_color: "00000000" },
    ],
    headers,
    config,
  });
  assert.equal(role.role, "other_working");
});

test("夜班跨入绿色节假日算加班", () => {
  const role = classifyRole({
    row: ["20261023", "夜班", "", "王爽"],
    styles: [
      { col: 0, background_color: "FFFFFFFF" },
      { col: 1, background_color: "FFB4C6E7" },
    ],
    nextStyles: [{ col: 0, background_color: "FF92D050" }],
    headers,
    config,
  });
  assert.equal(role.role, "night_primary");
  assert.equal(role.overtime, true);
});

test("纯白空白为夜班延续后的休息", () => {
  const role = classifyRole({
    row: ["20261012", "", "", ""],
    styles: [{ col: 1, background_color: "FFFFFFFF" }],
    headers,
    config,
  });
  assert.equal(role.role, "rest");
  assert.equal(role.restKind, "night-continuation-after-08:30");
});
