"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const ts = require("typescript");

function loadPlanModule() {
  const filename = path.join(__dirname, "../miniprogram/services/stitch-plan.ts");
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    }
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { exports: module.exports, module, require });
  return module.exports;
}

function source(width, height, index) {
  return {
    id: `image-${index}`,
    path: `image-${index}.png`,
    thumbPath: `image-${index}.png`,
    width,
    height,
    orientation: "up",
    order: index
  };
}

const seam = {
  pairIndex: 0,
  mode: "auto",
  prevCropEndRatio: 0.75,
  nextCropStartRatio: 0.25,
  fixedTopRatio: 0,
  fixedBottomRatio: 0,
  confidence: 1,
  margin: 1,
  textureCoverage: 1,
  overlapRatio: 0.5
};

test("横向拼接按左右裁切并生成宽幅输出", () => {
  const { buildStitchPlan } = loadPlanModule();
  const plan = buildStitchPlan([source(1600, 900, 0), source(1600, 900, 1)], [seam], 1, "horizontal");

  assert.equal(plan.direction, "horizontal");
  assert.equal(plan.outputHeight, 900);
  assert.equal(plan.outputWidth, 2400);
  assert.deepEqual(
    JSON.parse(JSON.stringify(plan.segments.map(({ sourceX, sourceWidth }) => ({ sourceX, sourceWidth })))),
    [
      { sourceX: 0, sourceWidth: 1200 },
      { sourceX: 400, sourceWidth: 1200 }
    ]
  );
});

test("竖向拼接维持现有上下裁切结果", () => {
  const { buildStitchPlan } = loadPlanModule();
  const plan = buildStitchPlan([source(900, 1600, 0), source(900, 1600, 1)], [seam]);

  assert.equal(plan.direction, "vertical");
  assert.equal(plan.outputWidth, 900);
  assert.equal(plan.outputHeight, 2400);
});
