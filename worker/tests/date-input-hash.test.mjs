import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {dateTimeInputValuesScript} from '../src/platforms/feishu-browser/dom-scripts.mjs';
test('date readers support both deployed CSS hashes and reject unrelated inputs',()=>{
 for(const hash of ['f9ce0c','ba7145']){
  const elements=[{className:`bitable-${hash}__calendar-picker-input`,value:'2026/11/03'},{className:`bitable-${hash}__time-picker-input`,value:'06:00'},{className:'unrelated',value:'wrong'}];
  const root={querySelector:selector=>{const match=selector.match(/^\[class\*=([^\]]+)\]$/);return match?elements.find(e=>e.className.includes(match[1])):null;}};
  const result=vm.runInNewContext(dateTimeInputValuesScript('#field'),{document:{querySelector:()=>root}});
  assert.equal(result.date,'2026/11/03');assert.equal(result.time,'06:00');
 }
});
