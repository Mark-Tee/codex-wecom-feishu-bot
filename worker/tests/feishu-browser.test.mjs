import test from "node:test";
import assert from "node:assert/strict";
import {
  assertNoOpenRecordForm,
  chooseWorkContent,
  diagnosticCodeForStage,
  FeishuBrowserFormFiller,
  matchOption,
  parseBitableTarget,
  resolvePersonFields,
} from "../src/platforms/feishu-browser/form-filler.mjs";
import {
  discoverFieldIds,
  mergeDiscoveredFieldIds,
  missingRequiredFieldIds,
  REQUIRED_BROWSER_FIELDS,
} from "../src/platforms/feishu-browser/field-discovery.mjs";
import {
  buildTestTask,
  percentile,
  summarizeBenchmark,
  tableFingerprint,
} from "../src/platforms/feishu-browser/e2e-benchmark.mjs";

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

test("字段自动发现按标签覆盖旧映射并补齐缺失字段", async () => {
  const fields = REQUIRED_BROWSER_FIELDS.map((key, index) => ({
    id: `fld${key}Example`,
    text: [
      "任务列表",
      "任务来源",
      "任务地点",
      "事务单号",
      "机房单号",
      "工作内容",
      "具体工作事项",
      "预计进入时间",
      "指派人员",
      "陪同人",
    ][index],
  }));
  const session = {
    async evaluate() {
      return fields;
    },
  };
  const discovery = await discoverFieldIds(session, {
    fieldIds: { location: "fldExampleLocation" },
  });
  assert.equal(discovery.missing.length, 0);
  assert.equal(discovery.missingActual.length, 0);
  assert.equal(discovery.fieldIds.location, "fldlocationExample");
  assert.equal(discovery.fieldIds.transactionNo, "fldtransactionNoExample");
});

test("字段自动发现报告缺失项且诊断阶段可分类", () => {
  const merged = mergeDiscoveredFieldIds({}, [
    { id: "fldTaskList", text: "任务列表" },
    { id: "fldBad", text: "无关字段" },
  ]);
  assert.equal(merged.taskList, "fldTaskList");
  assert.ok(missingRequiredFieldIds(merged).includes("companions"));
  assert.equal(diagnosticCodeForStage("open-browser"), "browser_open");
  assert.equal(diagnosticCodeForStage("discover-fields"), "field_discovery");
  assert.equal(diagnosticCodeForStage("fill:陪同人"), "field_fill");
  assert.equal(diagnosticCodeForStage("submit"), "submit");
});

test("真实表基准生成唯一测试单号并统计 P50/P95", () => {
  const first = buildTestTask({
    index: 0,
    operator: "测试甲",
    location: "测试机房",
    now: new Date("2026-10-26T20:00:00+08:00"),
    batchSeed: 123456,
  });
  const second = buildTestTask({
    index: 1,
    operator: "测试甲",
    location: "测试机房",
    now: new Date("2026-10-26T20:00:00+08:00"),
    batchSeed: 123456,
  });
  assert.equal(first.fillCard.transactionNo, "SJSW20261026123456");
  assert.equal(second.fillCard.transactionNo, "SJSW20261026123457");
  assert.match(first.fillCard.specificWork, /E2E-20261026-123456/);
  assert.equal(percentile([10, 20, 30, 40], 0.5), 20);
  assert.equal(percentile([10, 20, 30, 40], 0.95), 40);
  const summary = summarizeBenchmark([
    { ok: true, elapsedMs: 1000 },
    { ok: true, elapsedMs: 2000 },
    { ok: false, elapsedMs: 3000, code: "field_fill" },
  ]);
  assert.equal(summary.successRate, 2 / 3);
  assert.equal(summary.p50Ms, 2000);
  assert.equal(summary.failureCounts.field_fill, 1);
  assert.match(tableFingerprint("https://example.feishu.cn/base/example"), /^[a-f0-9]{12}$/);
  assert.notEqual(
    tableFingerprint("https://example.feishu.cn/base/example"),
    tableFingerprint("https://example.feishu.cn/base/other"),
  );
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

test("浏览器启动失败返回可分类诊断，不尝试填写", async () => {
  const filler = new FeishuBrowserFormFiller({
    config: {
      enabled: true,
      autoDiscoverFields: true,
      autoSubmit: true,
      formUrl: "https://example.feishu.cn/base/example?table=tblExample",
      edgeExecutable: "Z:\\missing\\msedge.exe",
      profileDir: "data/test-missing-profile",
      debugPort: 59999,
      launchTimeoutMs: 100,
      formTimeoutMs: 100,
      fieldIds: {},
      diagnostics: { enabled: false },
      options: { location: ["测试机房"] },
    },
  });
  const result = await filler.fill({
    operator: "测试甲",
    receivedAt: "2026-10-26T19:50:00+08:00",
    fillCard: {
      location: "测试机房",
      transactionNo: "SJSW20261026000123",
      roomTicketNo: "JF20261026000123",
      workContent: "故障维修、隐患整改",
      specificWork: "诊断测试",
      expectedEnterAt: "2026/10/26 20:00",
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.submitted, false);
  assert.equal(result.diagnostics.code, "browser_open");
  assert.equal(result.diagnostics.stage, "open-browser");
});
