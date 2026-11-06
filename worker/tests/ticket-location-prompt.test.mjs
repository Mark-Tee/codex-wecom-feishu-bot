import test from "node:test";
import assert from "node:assert/strict";
import {buildDutyPrompt} from "../src/core/duty-prompt.mjs";
import {buildPowerDutyPrompt} from "../src/core/power-duty-prompt.mjs";
import {buildFeishuTestPrompt} from "../src/core/feishu-test-prompt.mjs";

test("三种识别模式区分数据中心与机房模块，缺失时询问而非补猜", () => {
  for (const prompt of [
    buildDutyPrompt({context: {}}),
    buildPowerDutyPrompt({message: {}, context: {}}),
    buildFeishuTestPrompt({message: {}}),
  ]) {
    assert.match(prompt, /location 是工单的所属中心\/数据中心站点/);
    assert.match(prompt, /不能从机房编号、默认工作地或周报行推断/);
    assert.match(prompt, /机房模块保留在specificWork和任务描述/);
    assert.match(prompt, /needsClarification询问站点/);
  }
});
