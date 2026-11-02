import test from "node:test";
import assert from "node:assert/strict";
import { formatHelpText, HELP_ENTRIES } from "../src/runtime/help-entries.mjs";

test("帮助条目包含参数、示例和限制", () => {
  assert.ok(HELP_ENTRIES.length >= 10);
  for (const entry of HELP_ENTRIES) {
    assert.equal(typeof entry.trigger, "string");
    assert.equal(typeof entry.parameters, "string");
    assert.ok(entry.description);
    assert.ok(entry.example);
    assert.ok(entry.limits);
  }
});

test("帮助只列日常功能，并标明实际写入验收边界",()=>{
 const text=formatHelpText();
 for(const command of ["/as 姓名","/pending","/status","/fill 短号","/done 短号","/help"])assert.ok(text.includes(command));
 assert.match(text,/真实写入待实单验收/);assert.match(text,/动力值班无需/);
 assert.doesNotMatch(text,/\/(?:cancel|pair|invite|stop|operators|revoke)\b/);
});
