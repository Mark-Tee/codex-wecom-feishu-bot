import test from "node:test";
import assert from "node:assert/strict";
import {
  likelyOperatorMatch,
  matchOperator,
  parseOperatorRequest,
} from "../src/core/operator-identity.mjs";

const members = ["张明", "王爽", "李俊", "赵勇"];
const pinyinHints = {
  张明: ["zhangming", "zm"],
  王爽: ["wangshuang", "ws"],
  李俊: ["lijun", "lj"],
  赵勇: ["zhaoyong", "zy"],
};

test("解析自然语言使用人", () => {
  assert.deepEqual(parseOperatorRequest("我是王爽"), {
    name: "王爽",
    remainder: "",
    explicit: false,
  });
});

test("纠正同音或形近姓名", () => {
  const match = matchOperator("王霜", members, pinyinHints);
  assert.equal(match.best.name, "王爽");
  assert.equal(likelyOperatorMatch(match), true);
});

test("支持拼音纠正", () => {
  const match = matchOperator("wangsuang", members, pinyinHints);
  assert.equal(match.best.name, "王爽");
  assert.equal(likelyOperatorMatch(match), true);
});

test("差异过大的姓名不强行匹配", () => {
  const match = matchOperator("孙悟空", members, pinyinHints);
  assert.equal(likelyOperatorMatch(match), false);
});
