import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {scrollDropdownScript, optionRectScript} from "../src/platforms/feishu-browser/dom-scripts.mjs";

test("virtual options below the clip are not clicked until the field list scrolls", () => {
  const list = {scrollTop: 0, scrollHeight: 264, clientHeight: 127,
    getBoundingClientRect: () => ({top: 0, bottom: 127})};
  const option = {textContent: "布线、理线相关事项", childElementCount: 0,
    getBoundingClientRect: () => ({left: 0, top: 192 - list.scrollTop, width: 100, height: 32}),
    closest: selector => selector === ".b-select-list" ? list : null};
  const context = {getComputedStyle: () => ({visibility: "visible", display: "block"}),
    document: {querySelector: selector => {assert.equal(selector, "#work"); return {querySelector: () => list};}, querySelectorAll: () => [option]}};
  assert.equal(vm.runInNewContext(optionRectScript(option.textContent), context), null);
  assert.equal(vm.runInNewContext(scrollDropdownScript("#work", true), context), true);
  assert.equal(list.scrollTop, 127);
  assert.equal(vm.runInNewContext(optionRectScript(option.textContent), context).text, option.textContent);
  assert.equal(vm.runInNewContext(scrollDropdownScript("#work"), context), true);
  assert.equal(list.scrollTop, 137);
  assert.equal(vm.runInNewContext(scrollDropdownScript("#work"), context), false);
  assert.equal(vm.runInNewContext(scrollDropdownScript("#work", true), context), true);
  assert.equal(list.scrollTop, 0);
});

test("absent or non-scrollable dropdown does not scroll unrelated fields", () => {
  assert.equal(vm.runInNewContext(scrollDropdownScript("#work"), {document: {querySelector: () => null}}), false);
  const list = {clientHeight: 127, scrollHeight: 127, scrollTop: 0};
  assert.equal(vm.runInNewContext(scrollDropdownScript("#work"), {document: {querySelector: () => ({querySelector: () => list})}}), false);
  assert.equal(list.scrollTop, 0);
});
