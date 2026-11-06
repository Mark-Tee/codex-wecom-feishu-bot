import test from "node:test";
import assert from "node:assert/strict";
import {evidenceRegions, evidenceText, prepareImageEvidence} from "../src/platforms/image-evidence.mjs";
import {outputMessages} from "../src/runtime/codex-runner.mjs";
const row = (text, x, y, score = 0.6) => ({text, score, box: [[x,y],[x+100,y],[x+100,y+18],[x,y+18]]});

test("detail regions follow OCR labels and nearby values, not fixed screen coordinates", () => {
  const items = [row("具体工作描述", 20, 400), row("厂商甲布线", 150, 400), row("工作状态",20,10), row("正常",150,10)];
  const a = evidenceRegions(items);
  assert.equal(a.length, 1); assert(a[0].y > 300);
  const moved = items.map(i => ({...i, box: i.box.map(([x,y]) => [x,y+100])}));
  assert.equal(evidenceRegions(moved)[0].y, a[0].y+100);
  assert(evidenceRegions([...items, row("姓名",20,700),row("测试甲",150,700),row("机房出入编号",20,100),row("JF示例",150,100)]).length <= 2);
});

test("invalid coordinates ignored; low scores remain explicitly uncertain", () => {
  assert.deepEqual(evidenceRegions([{text:"具体描述",box:[[NaN,0]]}]), []);
  const original=[row("不确定字",1,2,0.51)];
  assert.match(evidenceText(original), /0.51，待核对/);
  assert.equal(original[0].text,"不确定字");
  assert.deepEqual(evidenceRegions([row("具体工作描述",20,400,0.99),row("清晰描述",150,400,0.99)]),[]);
});

test("detail crop includes every same-line fragment, including a low-confidence suffix", () => {
  const items = [row("具体工作描述：",20,400), row("清晰的前半句",150,400,0.99),
    row("机架位置",270,402,0.98), row("设备编号",400,403,0.6),
    row("姓名：",550,400), row("其他字段",680,400,0.5)];
  const [region] = evidenceRegions(items);
  assert(region.x + region.width >= 500, "must include the last description fragment");
  assert(region.x + region.width < 550, "must stop before the next field");
  const longLine = [row("具体工作描述：",20,400), row("模糊描述",150,400), row("末尾编号",1800,401)];
  const [longRegion] = evidenceRegions(longLine);
  assert(longRegion.x + longRegion.width >= 1900, "must not truncate wide fields at 1600px");
});

test("disabled or failed preparation retains original inputs", async () => {
  const message={images:[{path:"missing.jpg"}],ocrText:"原文"};
  assert.equal(await prepareImageEvidence(message,{}),message);
  assert.equal(await prepareImageEvidence(message,{ocr:{enabled:true,executable:"missing.exe"},dataDir:"unused"}),message);
});

test("model token usage is reported as tokens, with unknown usage left null", () => {
  assert.equal(outputMessages("").usage,null);
  assert.deepEqual(outputMessages(JSON.stringify({type:"turn.completed",usage:{input_tokens:123,cached_input_tokens:20,output_tokens:8}})).usage,
    {input_tokens:123,cached_input_tokens:20,output_tokens:8});
});
