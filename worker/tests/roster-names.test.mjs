import test from "node:test";
import assert from "node:assert/strict";
import { rosterNames } from "../src/core/roster-names.mjs";
import { resolveSiteAssignment } from "../src/core/site-assignment.mjs";
import { classifyRole } from "../src/core/duty-role.mjs";
import { powerDutyFromRows } from "../src/providers/tencent-docs/power-roster.mjs";

const headers = ["日期", "测试甲", "网络辅值", "网络1", "网络2", "网络3", "动力白班值班人员", "动力夜班值班人员"];
const config = {
  operator_name: "测试甲", line: { aux_column_header: "网络辅值" },
  schedule: { primary_white_value: "白班", primary_night_value: "夜班", primary_white_fill: "FFFF00", primary_night_fill: "B4C6E7" },
  site_rules: { enabled: true, home_site: "站点A", offsite_site: "站点B", departments: [
    { name: "网络", members: ["测试甲"], auxiliary_header: "网络辅值", offsite_headers: ["网络1", "网络2", "网络3"], offsite_role: "告警值班" },
  ] },
};

test("岗位姓名前数字只用于忽略匹配，不处理姓名中间或尾部数字", () => {
  assert.deepEqual(rosterNames("1测试甲、2测试乙"), ["测试甲", "测试乙"]);
  assert.deepEqual(rosterNames("测试甲2、测2试乙"), ["测试甲2", "测2试乙"]);
  assert.deepEqual(rosterNames("2 测试甲"), ["测试甲"]);
});

test("1或2前缀的外派人员不能误判待命，原单元格保持原样", () => {
  for (const prefix of ["1", "2"]) {
    const row = ["20261102", "白班", "", `${prefix}测试甲`, "", "", "", ""];
    const original = structuredClone(row);
    const role = classifyRole({ row, headers, config, styles: [{ col: 1, background_color: "FFFFFFFF" }] });
    assert.equal(role.role, "offsite_training");
    assert.equal(role.assignment.slot, "网络1");
    assert.equal(role.assignment.assignmentType, "告警值班");
    assert.deepEqual(row, original);
  }
});

test("不同数字前缀仍是同一人员，重复外派岗位须核对", () => {
  const row = ["20261102", "白班", "", "1测试甲", "2测试甲", "", "", ""];
  assert.throws(() => resolveSiteAssignment({ row, headers, config }), /重复/);
});

test("辅值与动力人员的前缀按相同姓名规则匹配", () => {
  const row = ["20261102", "白班", "2测试甲", "", "", "", "", ""];
  assert.equal(classifyRole({ row, headers, config, styles: [] }).role, "white_auxiliary");
  row[2] = ""; row[6] = "1测试甲";
  const role = powerDutyFromRows([headers, row], { receivedAt: "2026-11-02T10:00:00+08:00", operator: "测试甲" });
  assert.equal(role.matched, true);
  assert.notEqual(classifyRole({ row, headers, config, styles: [{ col: 1, background_color: "FFFFFFFF" }] }).role, "home_standby");
});
