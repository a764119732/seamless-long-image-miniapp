"use strict";

const FEATURE_COUNT = 32;
const AUTO_SIMILARITY = 0.93;
const AUTO_MARGIN = 0.03;
const MIN_TEXTURE_COVERAGE = 0.25;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function lumaAt(rgba, pixelIndex) {
  const offset = pixelIndex * 4;
  return rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114;
}

function createAnalysisFrame(input) {
  const { width, height, rgba } = input;
  if (!width || !height || !rgba || rgba.length < width * height * 4) {
    throw new Error("分析图片像素数据无效");
  }

  const luma = new Float32Array(height * FEATURE_COUNT);
  const edge = new Float32Array(height * FEATURE_COUNT);
  const variance = new Float32Array(height);

  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    let sumSquares = 0;
    let previous = 0;
    for (let feature = 0; feature < FEATURE_COUNT; feature += 1) {
      const x = clamp(Math.floor(((feature + 0.5) * width) / FEATURE_COUNT), 0, width - 1);
      const value = lumaAt(rgba, y * width + x);
      const index = y * FEATURE_COUNT + feature;
      luma[index] = value;
      edge[index] = feature === 0 ? 0 : Math.abs(value - previous);
      previous = value;
      sum += value;
      sumSquares += value * value;
    }
    const mean = sum / FEATURE_COUNT;
    variance[y] = Math.max(0, sumSquares / FEATURE_COUNT - mean * mean);
  }

  return { width, height, luma, edge, variance };
}

function compareRows(left, leftY, right, rightY) {
  let lumaDiff = 0;
  let edgeDiff = 0;
  let edgeDensity = 0;
  const leftOffset = leftY * FEATURE_COUNT;
  const rightOffset = rightY * FEATURE_COUNT;

  for (let feature = 0; feature < FEATURE_COUNT; feature += 1) {
    const leftIndex = leftOffset + feature;
    const rightIndex = rightOffset + feature;
    lumaDiff += Math.abs(left.luma[leftIndex] - right.luma[rightIndex]);
    edgeDiff += Math.abs(left.edge[leftIndex] - right.edge[rightIndex]);
    edgeDensity += left.edge[leftIndex] + right.edge[rightIndex];
  }

  // 连续截图的真实重叠通常来自同一批像素，允许轻微压缩与动态内容，
  // 但不能让整体色阶相近的错误位置也得到接近 1 的分数。
  const lumaSimilarity = 1 - lumaDiff / (FEATURE_COUNT * 160);
  const edgeSimilarity = 1 - edgeDiff / (FEATURE_COUNT * 160);
  return {
    similarity: clamp(lumaSimilarity * 0.7 + edgeSimilarity * 0.3, 0, 1),
    textured: Math.max(left.variance[leftY], right.variance[rightY]) >= 90,
    edgeDensity: edgeDensity / (FEATURE_COUNT * 2 * 255)
  };
}

function detectFixedBand(left, right, fromTop) {
  const limit = Math.max(0, Math.floor(Math.min(left.height, right.height) * 0.25));
  let consecutiveMisses = 0;
  let lastGood = -1;
  let similaritySum = 0;
  let similarityCount = 0;

  for (let offset = 0; offset < limit; offset += 1) {
    const leftY = fromTop ? offset : left.height - 1 - offset;
    const rightY = fromTop ? offset : right.height - 1 - offset;
    const comparison = compareRows(left, leftY, right, rightY);
    if (comparison.similarity >= 0.94) {
      consecutiveMisses = 0;
      lastGood = offset;
      similaritySum += comparison.similarity;
      similarityCount += 1;
    } else {
      consecutiveMisses += 1;
      if (consecutiveMisses >= 3) break;
    }
  }

  const band = lastGood + 1;
  const average = similarityCount ? similaritySum / similarityCount : 0;
  const minimumBand = Math.max(3, Math.floor(Math.min(left.height, right.height) * 0.015));
  return band >= minimumBand && average >= 0.95 ? band : 0;
}

function evaluateOverlap(left, right, leftEnd, rightStart, overlap) {
  const sampleCount = Math.min(48, overlap);
  const rowScores = [];
  let texturedRows = 0;

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const relative = sampleCount === 1 ? 0 : Math.round((sample * (overlap - 1)) / (sampleCount - 1));
    const comparison = compareRows(left, leftEnd - overlap + relative, right, rightStart + relative);
    rowScores.push(comparison.similarity);
    if (comparison.textured) texturedRows += 1;
  }

  rowScores.sort((a, b) => b - a);
  const keptCount = Math.max(1, Math.ceil(rowScores.length * 0.9));
  let score = 0;
  for (let index = 0; index < keptCount; index += 1) score += rowScores[index];

  return {
    overlap,
    similarity: score / keptCount,
    textureCoverage: texturedRows / sampleCount
  };
}

function chooseSeam(left, right, leftEnd, rightStart, overlap) {
  const minOffset = Math.max(0, Math.floor(overlap * 0.2));
  const maxOffset = Math.min(overlap - 1, Math.ceil(overlap * 0.8));
  let bestOffset = Math.floor(overlap / 2);
  let bestMetric = Number.POSITIVE_INFINITY;

  for (let offset = minOffset; offset <= maxOffset; offset += 1) {
    const comparison = compareRows(left, leftEnd - overlap + offset, right, rightStart + offset);
    const metric = 1 - comparison.similarity + comparison.edgeDensity * 0.35;
    if (metric < bestMetric) {
      bestMetric = metric;
      bestOffset = offset;
    }
  }

  return {
    leftY: leftEnd - overlap + bestOffset,
    rightY: rightStart + bestOffset
  };
}

function transposeInput(input) {
  if (!input || !input.rgba || !input.width || !input.height) {
    throw new Error("横向分析图片像素数据无效");
  }
  const rgba = new Uint8ClampedArray(input.width * input.height * 4);
  for (let y = 0; y < input.height; y += 1) {
    for (let x = 0; x < input.width; x += 1) {
      const sourceOffset = (y * input.width + x) * 4;
      const targetOffset = (x * input.height + y) * 4;
      rgba[targetOffset] = input.rgba[sourceOffset];
      rgba[targetOffset + 1] = input.rgba[sourceOffset + 1];
      rgba[targetOffset + 2] = input.rgba[sourceOffset + 2];
      rgba[targetOffset + 3] = input.rgba[sourceOffset + 3];
    }
  }
  return {
    width: input.height,
    height: input.width,
    rgba
  };
}

function analyzePairVertical(leftInput, rightInput, pairIndex = 0) {
  const left = leftInput.luma ? leftInput : createAnalysisFrame(leftInput);
  const right = rightInput.luma ? rightInput : createAnalysisFrame(rightInput);
  const fixedTop = detectFixedBand(left, right, true);
  const fixedBottom = detectFixedBand(left, right, false);
  const leftEnd = Math.max(1, left.height - fixedBottom);
  const rightStart = Math.min(right.height - 1, fixedTop);
  const available = Math.min(leftEnd, right.height - rightStart);
  const minOverlap = Math.max(6, Math.floor(available * 0.08));
  const maxOverlap = Math.max(minOverlap, Math.floor(available * 0.9));
  const candidates = [];

  // 每个分析像素约对应原图 4–6px。必须逐行搜索，否则奇偶步长会
  // 跳过真实重叠长度，并把仅相差一行的高频文字误判为低相似度。
  for (let overlap = minOverlap; overlap <= maxOverlap; overlap += 1) {
    candidates.push(evaluateOverlap(left, right, leftEnd, rightStart, overlap));
  }

  candidates.sort((a, b) => b.similarity - a.similarity);
  const best = candidates[0] || { overlap: 0, similarity: 0, textureCoverage: 0 };
  // 次优候选必须代表另一处独立接缝；距离过近的候选只是同一峰值的
  // 像素抖动，不能用于计算 0.03 的置信间隔。
  const separation = Math.max(10, Math.floor(available * 0.08));
  const second = candidates.find((candidate) => Math.abs(candidate.overlap - best.overlap) >= separation);
  const margin = second ? best.similarity - second.similarity : best.similarity;
  const accepted = best.similarity >= AUTO_SIMILARITY && margin >= AUTO_MARGIN && best.textureCoverage >= MIN_TEXTURE_COVERAGE;

  if (!accepted || best.overlap <= 0) {
    return {
      pairIndex,
      mode: "manual",
      prevCropEndRatio: round(leftEnd / left.height),
      nextCropStartRatio: round(rightStart / right.height),
      fixedTopRatio: round(fixedTop / right.height),
      fixedBottomRatio: round(fixedBottom / left.height),
      confidence: round(best.similarity),
      margin: round(margin),
      textureCoverage: round(best.textureCoverage),
      overlapRatio: round(best.overlap / Math.max(1, available))
    };
  }

  const seam = chooseSeam(left, right, leftEnd, rightStart, best.overlap);
  return {
    pairIndex,
    mode: "auto",
    prevCropEndRatio: round(seam.leftY / left.height),
    nextCropStartRatio: round(seam.rightY / right.height),
    fixedTopRatio: round(fixedTop / right.height),
    fixedBottomRatio: round(fixedBottom / left.height),
    confidence: round(best.similarity),
    margin: round(margin),
    textureCoverage: round(best.textureCoverage),
    overlapRatio: round(best.overlap / Math.max(1, available))
  };
}

function analyzePair(leftInput, rightInput, pairIndex = 0, direction = "vertical") {
  if (direction === "horizontal") {
    return analyzePairVertical(transposeInput(leftInput), transposeInput(rightInput), pairIndex);
  }
  return analyzePairVertical(leftInput, rightInput, pairIndex);
}

function analyzePairWithOrderHint(leftInput, rightInput, pairIndex = 0, direction = "vertical") {
  const result = analyzePair(leftInput, rightInput, pairIndex, direction);
  if (result.mode !== "manual") return result;

  const reversed = analyzePair(rightInput, leftInput, pairIndex, direction);
  return reversed.mode === "auto" ? { ...result, orderHint: true } : result;
}

module.exports = {
  FEATURE_COUNT,
  AUTO_SIMILARITY,
  AUTO_MARGIN,
  MIN_TEXTURE_COVERAGE,
  createAnalysisFrame,
  detectFixedBand,
  analyzePair,
  analyzePairWithOrderHint
};
