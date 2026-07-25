"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzePair } = require("../miniprogram/workers/stitch-core");

const CATEGORIES = ["chat", "web", "notes"];
const CATEGORY_SEED = { chat: 17, web: 83, notes: 149 };

function hashByte(y, x, seed) {
  let value = Math.imul(y + seed, 73_856_093) ^ Math.imul(x + seed * 3, 19_349_663);
  value ^= value >>> 13;
  value = Math.imul(value, 1_274_126_177);
  return (value ^ (value >>> 16)) & 255;
}

function categoryPixel(category, globalY, x, width) {
  const seed = CATEGORY_SEED[category];
  const normalizedX = Math.floor((x / width) * 128);
  const noise = hashByte(globalY, normalizedX, seed);
  const lineEnd = 52 + (hashByte(globalY, 3, seed) % 68);
  const onText = globalY % 14 < 5 && normalizedX > 10 && normalizedX < lineEnd;
  if (category === "chat") {
    const bubbleSide = Math.floor(globalY / 22) % 2;
    const inBubble = bubbleSide ? normalizedX > 34 : normalizedX < 94;
    if (inBubble && onText) return [45 + (noise % 70), 70 + (noise % 55), 62 + (noise % 60)];
    return inBubble ? [210 + (noise % 30), 232 + (noise % 20), 222 + (noise % 24)] : [247, 249, 248];
  }
  if (category === "web") {
    const inMedia = globalY % 64 >= 30 && globalY % 64 <= 54;
    if (!inMedia && onText) return [40 + (noise % 75), 48 + (noise % 68), 45 + (noise % 72)];
    return inMedia ? [150 + (noise % 55), 185 + (noise % 45), 205 + (noise % 40)] : [225 + (noise % 28), 228 + (noise % 25), 226 + (noise % 26)];
  }
  return onText ? [35 + (noise % 90), 42 + (noise % 82), 39 + (noise % 86)] : [250, 250, 249];
}

function createFixture(category, contentStart, contentHeight = 200) {
  const width = 128;
  const fixedTop = 18;
  const fixedBottom = 16;
  const height = fixedTop + contentHeight + fixedBottom;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let rgb;
      if (y < fixedTop) rgb = [238 + (x % 5), 243, 241];
      else if (y >= fixedTop + contentHeight) rgb = [232, 239 + (x % 4), 236];
      else rgb = categoryPixel(category, contentStart + y - fixedTop, x, width);
      const offset = (y * width + x) * 4;
      rgba[offset] = rgb[0];
      rgba[offset + 1] = rgb[1];
      rgba[offset + 2] = rgb[2];
      rgba[offset + 3] = 255;
    }
  }
  return { width, height, rgba, fixedTop, fixedBottom, contentStart, contentHeight };
}

test("聊天、网页、笔记各 20 组样本达到至少 95% 自动匹配率", () => {
  const outcomes = [];
  for (const category of CATEGORIES) {
    for (let caseIndex = 0; caseIndex < 20; caseIndex += 1) {
      const overlapPercent = [20, 35, 50, 65, 80][caseIndex % 5];
      const contentHeight = 200;
      const overlap = Math.round((contentHeight * overlapPercent) / 100);
      const contentStart = caseIndex * 257 + CATEGORY_SEED[category];
      const left = createFixture(category, contentStart, contentHeight);
      const right = createFixture(category, contentStart + contentHeight - overlap, contentHeight);
      const result = analyzePair(left, right, caseIndex);
      const leftGlobal = left.contentStart + result.prevCropEndRatio * left.height - left.fixedTop;
      const rightGlobal = right.contentStart + result.nextCropStartRatio * right.height - right.fixedTop;
      outcomes.push({
        category,
        mode: result.mode,
        error: Math.abs(leftGlobal - rightGlobal),
        confidence: result.confidence,
        margin: result.margin,
        textureCoverage: result.textureCoverage
      });
    }
  }

  const automatic = outcomes.filter((outcome) => outcome.mode === "auto");
  const accurate = automatic.filter((outcome) => outcome.error <= 8);
  assert.equal(outcomes.length, 60);
  const diagnostics = CATEGORIES.map((category) => {
    const sample = outcomes.filter((outcome) => outcome.category === category);
    const averages = ["confidence", "margin", "textureCoverage"].map((key) =>
      (sample.reduce((sum, outcome) => sum + outcome[key], 0) / sample.length).toFixed(3)
    );
    return `${category}:${sample.filter((outcome) => outcome.mode === "auto").length}/20 c=${averages[0]} m=${averages[1]} t=${averages[2]}`;
  }).join("; ");
  assert.ok(automatic.length / outcomes.length >= 0.95, `自动匹配率仅 ${automatic.length}/60; ${diagnostics}`);
  assert.equal(accurate.length, automatic.length, "自动接缝误差必须不超过 8px");
  for (const category of CATEGORIES) {
    assert.equal(outcomes.filter((outcome) => outcome.category === category).length, 20);
  }
});
