"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");

function loadPage(wx = { showToast() {} }) {
  let page;
  const timers = [];
  function load(relativePath) {
    const filename = path.resolve(__dirname, "..", relativePath);
    const module = { exports: {} };
    const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText;
    vm.runInNewContext(source, {
      module, exports: module.exports, Error,
      wx,
      setTimeout(callback, delay) { if (delay <= 32) callback(); else timers.push(callback); }, clearTimeout() {},
      Page(definition) {
        page = { ...definition, data: { ...definition.data },
          setData(patch, callback) { Object.assign(this.data, patch); callback?.(); } };
      },
      require(request) {
        if (request.endsWith("/cloudbase")) return { saveStitchRecord() {} };
        const target = path.resolve(path.dirname(filename), request);
        return load(fs.existsSync(`${target}.ts`) ? `${target}.ts` : `${target}.js`);
      }
    });
    return module.exports;
  }
  const { buildStitchPlan } = load("miniprogram/services/stitch-plan.ts");
  load("miniprogram/pages/index/index.ts");
  page.data.images = [
    { id: "one", path: "one.png", thumbPath: "one.png", width: 1080, height: 2400 },
    { id: "two", path: "two.png", thumbPath: "two.png", width: 1080, height: 3200 }
  ];
  page.data.seams = [{ pairIndex: 0, mode: "auto", prevCropEndRatio: 0.8543,
    nextCropStartRatio: 0.2137, overlapRatio: 0.4 }];
  return { page, buildStitchPlan };
}

test("手动预览显示完整原图，裁切线所在容器和原图保持相同比例", () => {
  const { page } = loadPage();
  const wxml = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/index/index.wxml"), "utf8");
  const cropImages = wxml.match(/<image class="crop-image"[^>]*>/g);
  assert.equal(cropImages.length, 2);
  for (const image of cropImages) assert.match(image, /mode="aspectFit"/);
  for (const direction of ["vertical", "horizontal"]) {
    page.data.stitchDirection = direction;
    if (direction === "horizontal") {
      page.data.images.forEach((image) => { [image.width, image.height] = [image.height, image.width]; });
    }
    page.beginSeamEdit(0);
    for (const [index, size] of [page.data.manualPrevSize, page.data.manualNextSize].entries()) {
      const image = page.data.images[index];
      assert.ok(Math.abs(size.width / size.height - image.width / image.height) < 0.00001);
      assert.ok(size.width <= 326 && size.height <= 470);
    }
  }
});

test("打开手动调整直接确认不会改变已有接缝的像素位置", () => {
  const { page, buildStitchPlan } = loadPage();
  const before = buildStitchPlan(page.data.images, page.data.seams);
  page.beginSeamEdit(0);
  page.confirmManual();
  const after = buildStitchPlan(page.data.images, page.data.seams);
  assert.equal(after.segments[0].sourceHeight, before.segments[0].sourceHeight);
  assert.equal(after.segments[1].sourceY, before.segments[1].sourceY);
});

test("不同长度图片联动调整移动相同像素，不新增重复或缺失内容", () => {
  const { page, buildStitchPlan } = loadPage();
  for (const direction of ["vertical", "horizontal"]) {
    page.data.stitchDirection = direction;
    if (direction === "horizontal") {
      page.data.images.forEach((image) => { [image.width, image.height] = [image.height, image.width]; });
    }
    const before = buildStitchPlan(page.data.images, page.data.seams, 1, direction);
    page.beginSeamEdit(0);
    page.onLinkedSeamChange({ detail: { value: 80 } });
    page.confirmManual();
    const after = buildStitchPlan(page.data.images, page.data.seams, 1, direction);
    const key = direction === "vertical" ? "rawHeight" : "rawWidth";
    assert.ok(Math.abs(before[key] - after[key]) <= 1, `${direction}: ${before[key]} -> ${after[key]}`);
  }
});

test("相邻接缝交叉时留在手动编辑，不接受会令导出失败的裁切", () => {
  const { page } = loadPage();
  page.data.images.push({ ...page.data.images[1], id: "three" });
  page.data.seams[0].nextCropStartRatio = 0.7;
  page.data.seams.push({ ...page.data.seams[0], pairIndex: 1, prevCropEndRatio: 0.9 });
  page.beginSeamEdit(1);
  page.onManualPrevChange({ detail: { value: 20 } });
  page.confirmManual();
  assert.equal(page.data.state, "manual");
  assert.equal(page.data.seams[1].prevCropEndRatio, 0.9);
});

test("预览使用实际 PNG 尺寸，短图和超长图都不拉伸", async () => {
  let exportedSize;
  const { page } = loadPage({
    canvasToTempFilePath({ destWidth, destHeight, success }) {
      exportedSize = [destWidth, destHeight];
      success({ tempFilePath: "preview.png" });
    }
  });
  const canvas = {
    width: 0, height: 0,
    getContext() { return { fillRect() {}, drawImage() {} }; },
    createImage() {
      return { width: 0, height: 0, onload: null, onerror: null,
        set src(value) { if (value) this.onload(); } };
    }
  };
  page.createSelectorQuery = () => ({
    select() { return this; }, fields() { return this; },
    exec(callback) { callback([{ node: canvas }]); }
  });
  for (const direction of ["vertical", "horizontal"]) {
    page.data.stitchDirection = direction;
    for (const longEdge of [1100, 20000]) {
      page.data.images.forEach(image => Object.assign(image,
        direction === "vertical" ? { width: 1000, height: longEdge } : { width: longEdge, height: 1000 }));
      page.data.state = "preview";
      await page.renderOverview();
      assert.equal(page.data.state, "preview");
      assert.equal(page.data.previewPath, "preview.png");
      assert.deepEqual([page.data.previewCanvasWidth, page.data.previewCanvasHeight], exportedSize);
    }
  }
});

test("联动滑块在中点和边界不改变总保留长度", () => {
  const { page, buildStitchPlan } = loadPage();
  page.data.seams[0].prevCropEndRatio = 1;
  page.data.seams[0].nextCropStartRatio = 0;
  const before = buildStitchPlan(page.data.images, page.data.seams).rawHeight;
  for (const value of [0, 50, 100]) {
    page.beginSeamEdit(0);
    page.onLinkedSeamChange({ detail: { value } });
    page.confirmManual();
    assert.equal(buildStitchPlan(page.data.images, page.data.seams).rawHeight, before);
  }
});
