"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const ts = require("typescript");

const SHARE_TITLE = "青缝长图拼接｜连续截图自动去重复叠";
const SHARE_PATH = "/pages/index/index";
const SHARE_IMAGE = "/assets/share-card.png";

function loadIndexPage() {
  const filename = path.join(__dirname, "../miniprogram/pages/index/index.ts");
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    }
  }).outputText;
  let definition = null;

  vm.runInNewContext(compiled, {
    exports: {},
    module: { exports: {} },
    Page(options) {
      definition = options;
    },
    wx: {},
    console,
    setTimeout,
    clearTimeout,
    require(request) {
      if (request.endsWith("/canvas")) {
        return {
          createAnalysisImage() {},
          renderPlanToCanvas() {},
          releaseCanvasImages() {},
          canvasToPng() {}
        };
      }
      if (request.endsWith("/stitch-plan")) {
        return { buildStitchPlan() {}, MIN_OUTPUT_WIDTH: 320 };
      }
      if (request.endsWith("/source-validation")) {
        return { validatePortraitImage() {} };
      }
      throw new Error(`Unexpected import: ${request}`);
    }
  });

  assert.ok(definition, "页面应完成注册");
  return definition;
}

function readPngDimensions(filename) {
  const image = fs.readFileSync(filename);
  assert.equal(image.toString("ascii", 1, 4), "PNG");
  return {
    width: image.readUInt32BE(16),
    height: image.readUInt32BE(20)
  };
}

test("用户可分享固定首页卡片，且卡片不包含本地拼接结果", () => {
  const page = loadIndexPage();

  assert.deepEqual(JSON.parse(JSON.stringify(page.onShareAppMessage())), {
    title: SHARE_TITLE,
    path: SHARE_PATH,
    imageUrl: SHARE_IMAGE
  });
  assert.deepEqual(JSON.parse(JSON.stringify(page.onShareTimeline())), {
    title: SHARE_TITLE,
    query: "",
    imageUrl: SHARE_IMAGE
  });

  const serialized = JSON.stringify({
    friend: page.onShareAppMessage(),
    timeline: page.onShareTimeline()
  });
  assert.doesNotMatch(serialized, /resultPath|tempFilePath|showShareImageMenu/);

  const shareImage = path.join(__dirname, "../miniprogram/assets/share-card.png");
  assert.deepEqual(readPngDimensions(shareImage), { width: 500, height: 400 });
});
