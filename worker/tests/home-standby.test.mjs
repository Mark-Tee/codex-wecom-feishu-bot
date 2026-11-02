import test from "node:test";
import assert from "node:assert/strict";
import { classifyRole } from "../src/core/duty-role.mjs";
import { applySiteRecordRules } from "../src/core/site-assignment.mjs";

const headers = ["日期", "测试甲", "网络辅值", "异地1", "动力白班值班人员", "动力夜班值班人员"];
const config = {
  operator_name: "测试甲",
  line: { aux_column_header: "网络辅值", team_members: ["测试甲"] },
  schedule: { primary_white_value: "白班", primary_night_value: "夜班", primary_white_fill: "FFFF00", primary_night_fill: "B4C6E7" },
  site_rules: { enabled: true, home_site: "站点A", home_site_aliases: ["站点A"], offsite_site: "站点B", departments: [
    { name: "网络", members: ["测试甲"], auxiliary_header: "网络辅值", offsite_headers: ["异地1"], offsite_role: "培训" },
  ] },
};
const base = () => ["20261102", "白班", "", "", "", ""];
const classify = (row = base(), fill = "FFFFFFFF", override = {}) => classifyRole({ row, styles: [{ col: 1, background_color: fill }], headers, config, ...override });

test("明确在岗普通白班且没有固定岗位时为本站待命", () => {
  const role = classify();
  assert.equal(role.role, "home_standby");
  assert.equal(role.assignment.site, "站点A");
  assert.equal(role.assignment.assignmentType, "待命");
});

test("明确休假不判待命，白色空白夜班延续休息保持不变", () => {
  for (const label of ["调休", "休假", "休息", "年假", "病假", "事假"]) {
    const row = base(); row[1] = label;
    assert.equal(classify(row).role, "rest", label);
  }
  const blank = base(); blank[1] = "";
  assert.equal(classify(blank).restKind, "night-continuation-after-08:30");
});

test("主值、辅值、动力和外派不能误判为待命；缺动力列需确认", () => {
  assert.equal(classify(base(), "FFFF00").role, "white_primary");
  const aux = base(); aux[2] = "测试甲"; assert.equal(classify(aux).role, "white_auxiliary");
  for (const index of [4, 5]) {
    const power = base(); power[index] = "测试甲";
    assert.notEqual(classify(power).role, "home_standby");
  }
  const away = base(); away[3] = "测试甲"; assert.equal(classify(away).role, "offsite_training");
  assert.equal(classify(base(), "FFFFFFFF", { headers: headers.slice(0, -1) }).requiresClarification, true);
});

test("休假与岗位同时出现时提示冲突，不擅自认定待命或出勤", () => {
  const row = base(); row[1] = "休假"; row[3] = "测试甲";
  const role = classify(row);
  assert.equal(role.role, "ambiguous");
  assert.equal(role.requiresClarification, true);
});

test("待命只保留明确的一条实际工单，移除交接，拒绝默认记录", () => {
  const context = { shiftDate: "20261102", schedule: [{ date: "20261102", role: classify() }] };
  const fillCard = { location: "站点A", transactionNo: "SJSW20261102000001", roomTicketNo: "JF20261102000001", specificWork: "陪同更换部件" };
  const row = [1, "站点A", "其他临时工作", "陪同更换部件"];
  const result = applySiteRecordRules({ weeklyRows: [row], handoverRows: [["默认交接"]] }, { context, fillCard, config });
  assert.deepEqual(result.spec.weeklyRows, [row]);
  assert.deepEqual(result.spec.handoverRows, []);
  for (const spec of [{ weeklyRows: [], handoverRows: [] }, { weeklyRows: [row, row], handoverRows: [] }]) {
    assert.throws(() => applySiteRecordRules(spec, { context, fillCard, config }), /待命本身不生成记录/);
  }
  assert.throws(() => applySiteRecordRules({ weeklyRows: [[1, "站点A", "其他", "网络通报"]], handoverRows: [] }, { context, fillCard, config }), /不能附加/);
  assert.throws(() => applySiteRecordRules({ weeklyRows: [row], handoverRows: [] }, { context, fillCard: {}, config }), /待命本身不生成记录/);
});
