"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzePair, analyzePairWithOrderHint, createAnalysisFrame } = require("../miniprogram/workers/stitch-core");
const { validatePortraitImage } = require("../miniprogram/lib/source-validation");

function createScreenshot({
  width = 96,
  contentStart = 0,
  contentHeight = 160,
  fixedTop = 16,
  fixedBottom = 14,
  blank = false,
  mutateRows = [],
  variant = 0
}) {
  const height = fixedTop + contentHeight + fixedBottom;
  const rgba = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r;
      let g;
      let b;
      if (y < fixedTop) {
        r = 236 + (Math.floor((x / width) * 8) % 6);
        g = 241;
        b = 239;
      } else if (y >= fixedTop + contentHeight) {
        r = 226;
        g = 235 + (Math.floor((x / width) * 12) % 8);
        b = 232;
      } else if (blank) {
        r = g = b = 250;
      } else {
        const globalY = contentStart + y - fixedTop;
        const normalizedX = Math.floor((x / width) * 96);
        const mutated = mutateRows.includes(globalY) ? 67 : 0;
        r = (globalY * (variant ? 13 : 37) + normalizedX * (variant ? 31 : 19) + mutated + variant * 47) % 256;
        g = (globalY * (variant ? 43 : 17) + normalizedX * (variant ? 7 : 29) + 41 + mutated) % 256;
        b = (globalY * (variant ? 5 : 23) + normalizedX * (variant ? 37 : 11) + 89 + mutated) % 256;
      }
      const offset = (y * width + x) * 4;
      rgba[offset] = r;
      rgba[offset + 1] = g;
      rgba[offset + 2] = b;
      rgba[offset + 3] = 255;
    }
  }
  return { width, height, rgba, fixedTop, fixedBottom, contentStart, contentHeight };
}

function assertAlignedSeam(left, right, result, tolerance = 2) {
  const leftY = result.prevCropEndRatio * left.height - left.fixedTop;
  const rightY = result.nextCropStartRatio * right.height - right.fixedTop;
  const leftGlobal = left.contentStart + leftY;
  const rightGlobal = right.contentStart + rightY;
  assert.ok(Math.abs(leftGlobal - rightGlobal) <= tolerance, `接缝内容位置应对齐：${leftGlobal} vs ${rightGlobal}`);
}

for (const overlapPercent of [20, 50, 80]) {
  test(`识别 ${overlapPercent}% 的连续截图重叠`, () => {
    const contentHeight = 160;
    const overlap = Math.round((contentHeight * overlapPercent) / 100);
    const left = createScreenshot({ contentStart: 0, contentHeight });
    const right = createScreenshot({ contentStart: contentHeight - overlap, contentHeight });
    const result = analyzePair(left, right, 0);
    assert.equal(result.mode, "auto", JSON.stringify(result));
    assert.ok(result.confidence >= 0.93);
    assertAlignedSeam(left, right, result);
  });
}

test("识别并排除固定标题栏与底部输入栏", () => {
  const left = createScreenshot({ contentStart: 0, fixedTop: 20, fixedBottom: 18 });
  const right = createScreenshot({ contentStart: 80, fixedTop: 20, fixedBottom: 18 });
  const result = analyzePair(left, right, 1);
  assert.equal(result.mode, "auto", JSON.stringify(result));
  assert.ok(Math.abs(result.fixedTopRatio - 20 / right.height) < 0.03);
  assert.ok(Math.abs(result.fixedBottomRatio - 18 / left.height) < 0.03);
  assertAlignedSeam(left, right, result);
});

test("少量动态行不会破坏可靠匹配", () => {
  const left = createScreenshot({ contentStart: 0 });
  const right = createScreenshot({ contentStart: 80, mutateRows: [92, 93, 118, 119] });
  const result = analyzePair(left, right, 2);
  assert.equal(result.mode, "auto", JSON.stringify(result));
  assertAlignedSeam(left, right, result, 3);
});

test("不同像素宽度的输入保守转入手动接缝", () => {
  const left = createScreenshot({ width: 96, contentStart: 0 });
  const right = createScreenshot({ width: 72, contentStart: 80 });
  const result = analyzePair(createAnalysisFrame(left), createAnalysisFrame(right), 3);
  assert.equal(result.mode, "manual");
});

test("没有重叠时进入手动接缝而不是猜测", () => {
  const left = createScreenshot({ contentStart: 0 });
  const right = createScreenshot({ contentStart: 400, variant: 1 });
  const result = analyzePair(left, right, 4);
  assert.equal(result.mode, "manual");
});

test("截图顺序反了时给出排序提示", () => {
  const earlier = createScreenshot({ contentStart: 0 });
  const later = createScreenshot({ contentStart: 80 });
  const result = analyzePairWithOrderHint(later, earlier, 5);
  assert.equal(result.mode, "manual");
  assert.equal(result.orderHint, true);
});

test("纯色低纹理页面进入手动接缝", () => {
  const left = createScreenshot({ contentStart: 0, blank: true });
  const right = createScreenshot({ contentStart: 80, blank: true });
  const result = analyzePair(left, right, 5);
  assert.equal(result.mode, "manual");
  assert.ok(result.textureCoverage < 0.25);
});

test("无效像素输入给出明确错误", () => {
  assert.throws(() => createAnalysisFrame({ width: 20, height: 20, rgba: new Uint8ClampedArray(8) }), /像素数据无效/);
});

test("横向或旋转后的截图在导入阶段被明确拒绝", () => {
  assert.equal(validatePortraitImage({ width: 1170, height: 2532 }), true);
  assert.throws(() => validatePortraitImage({ width: 2532, height: 1170 }), /只支持竖向截图/);
});

test("20 张连续截图可依次生成 19 个可靠接缝", () => {
  const screenshots = Array.from({ length: 20 }, (_, index) => createScreenshot({ contentStart: index * 80 }));
  const results = screenshots.slice(0, -1).map((left, index) => analyzePair(left, screenshots[index + 1], index));
  assert.equal(results.length, 19);
  assert.equal(results.filter((result) => result.mode === "auto").length, 19);
});
