"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("小程序不包含用户图片发布或拼接结果分享入口", () => {
  const pageLogic = read("miniprogram/pages/index/index.ts");
  const pageTemplate = read("miniprogram/pages/index/index.wxml");
  const apiTypes = read("miniprogram/types/global.d.ts");
  const readme = read("README.md");
  const handoff = read("docs/SESSION-HANDOFF-2026-07-23.md");

  assert.doesNotMatch(pageLogic, /shareResult|showShareImageMenu/);
  assert.doesNotMatch(pageTemplate, /bindtap="shareResult"|<text>分享<\/text>/);
  assert.doesNotMatch(apiTypes, /showShareImageMenu|canIUse/);
  assert.doesNotMatch(readme, /系统图片分享/);
  assert.doesNotMatch(handoff, /保存和分享/);
  assert.equal(fs.existsSync(path.join(__dirname, "../miniprogram/assets/icons/share.svg")), false);
});
