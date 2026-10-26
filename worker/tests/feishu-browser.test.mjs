import test from "node:test";
import assert from "node:assert/strict";
import {
  assertNoOpenRecordForm,
  chooseWorkContent,
  FeishuBrowserFormFiller,
  matchOption,
  parseBitableTarget,
  resolvePersonFields,
} from "../src/platforms/feishu-browser/form-filler.mjs";

test("检测到已有记录卡时拒绝复用其他用户的记录", () => {
  assert.doesNotThrow(() => assertNoOpenRecordForm(false));
  assert.throws(
    () => assertNoOpenRecordForm(true),
    /拒绝复用/,
  );
});

test("飞书下拉选项允许标点和空白差异", () => {
  const options = ["故障维修、隐患整改", "测试机房"];
  assert.equal(matchOption("故障维修,隐患整改", options), options[0]);
  assert.equal(matchOption("测试 机房", options), options[1]);
  assert.equal(matchOption("未知地点", options), "");
});

test("工作内容按工单动作映射到可用选项", () => {
  const options = [
    "故障维修、隐患整改",
    "硬件带外不通，测试设备排查",
    "无故障进入机房",
    "宕机物理重启",
    "网线光纤插拔",
    "上下架相关事项",
  ];
  assert.equal(
    chooseWorkContent({ specificWork: "更换故障光模块" }, options),
    "故障维修、隐患整改",
  );
  assert.equal(
    chooseWorkContent({ specificWork: "服务器宕机后物理重启" }, options),
    "宕机物理重启",
  );
  assert.equal(
    chooseWorkContent({ specificWork: "厂商进入机房更换硬盘" }, options),
    "无故障进入机房",
  );
  assert.equal(
    chooseWorkContent({ specificWork: "更换网线并重新插拔光纤" }, options),
    "网线光纤插拔",
  );
});

test("指派人员和陪同人都使用机器人当前使用人", () => {
  assert.deepEqual(resolvePersonFields({ operator: " 测试甲 " }), {
    assignees: "测试甲",
    companions: "测试甲",
  });
  assert.deepEqual(resolvePersonFields({}), {
    assignees: "",
    companions: "",
  });
});

test("从飞书表单地址解析多维表格定位信息", () => {
  assert.deepEqual(
    parseBitableTarget(
      "https://example.feishu.cn/base/appToken123?table=tblTable123&view=vewExample",
    ),
    {
      origin: "https://example.feishu.cn",
      appToken: "appToken123",
      tableId: "tblTable123",
    },
  );
});

test("浏览器未启用时不会启动 Edge", async () => {
  const filler = new FeishuBrowserFormFiller({ config: { enabled: false } });
  const result = await filler.fill({});
  assert.equal(result.configured, false);
  assert.match(result.message, /未启用/);
});

test("事务单号或机房单号格式错误时禁止启动浏览器", async () => {
  const filler = new FeishuBrowserFormFiller({
    config: {
      enabled: true,
      formUrl: "https://example.feishu.cn/base/form",
      fieldIds: { location: "fldLocation" },
    },
  });
  const result = await filler.fill({
    fillCard: {
      transactionNo: "SJSW20261026",
      roomTicketNo: "JF20261026",
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.submitted, false);
  assert.deepEqual(result.failed, ["单号格式"]);
  assert.match(result.message, /事务单号格式不正确/);
  assert.match(result.message, /机房单号格式不正确/);
});
