"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");

function loadPage(wx = { showToast() {} }, adUnitId = "") {
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
        if (request.endsWith("/config/monetization")) return { GRID_REWARDED_AD_UNIT_ID: adUnitId };
        if (request.endsWith("/cloudbase")) return { saveStitchRecord() {} };
        const target = path.resolve(path.dirname(filename), request);
        return load(fs.existsSync(`${target}.ts`) ? `${target}.ts` : `${target}.js`);
      }
    });
    return module.exports;
  }
  const { buildStitchPlan } = load("miniprogram/services/stitch-plan.ts");
  const { buildPhotoGridPlan, exportPhotoGridTiles } = load("miniprogram/services/photo-grid.ts");
  load("miniprogram/pages/index/index.ts");
  page.data.images = [
    { id: "one", path: "one.png", thumbPath: "one.png", width: 1080, height: 2400 },
    { id: "two", path: "two.png", thumbPath: "two.png", width: 1080, height: 3200 }
  ];
  page.data.seams = [{ pairIndex: 0, mode: "auto", prevCropEndRatio: 0.8543,
    nextCropStartRatio: 0.2137, overlapRatio: 0.4 }];
  return { page, buildStitchPlan, buildPhotoGridPlan, exportPhotoGridTiles };
}

test("单张图片切成九个连续正方形格子，横竖图和非整除尺寸均无缺口", () => {
  const { buildPhotoGridPlan } = loadPage();
  for (const [width, height] of [[1080, 1080], [1280, 768], [768, 1280], [6001, 4000], [1, 2]]) {
    const images = [{ width, height }];
    for (const scale of [1, 0.8, 0.64, 0.08]) {
      const plan = buildPhotoGridPlan(images, scale);
      assert.equal(plan.cells.length, 9);
      assert.equal(plan.outputWidth, plan.outputHeight);
      assert.ok(plan.outputWidth <= 3240);
      for (const [i, cell] of plan.cells.entries()) {
        assert.equal(cell.x, (i % 3) * cell.size);
        assert.equal(cell.y, Math.floor(i / 3) * cell.size);
        assert.equal(cell.size * 3, plan.outputWidth);
        assert.ok(cell.size > 0 && cell.size <= 1080);
      }
    }
  }
  for (const scale of [0, NaN, Infinity, -1]) assert.throws(() => buildPhotoGridPlan([{ width: 1, height: 1 }], scale));
  assert.throws(() => buildPhotoGridPlan([{ width: 0, height: 1 }]));
});

test("九宫格预览免费，横竖图补白完整保留，广告不可用时导出九个独立文件", async () => {
 for (const [width, height] of [[1080, 1080], [1280, 768], [768, 1280]]) {
  const draws = [];
  const toasts = [];
  let snapshots = 0;
  let decodes = 0;
  const { page } = loadPage({
    canvasToTempFilePath({ success }) { success({ tempFilePath: `grid-${++snapshots}.png` }); },
    showToast(options) { toasts.push(options.title); },
    createRewardedVideoAd() { throw Error("未配置广告位时不应请求"); }
  });
  const canvas = {
    getContext() { return { fillRect() {}, drawImage(...args) { draws.push(args); } }; },
    createImage() { decodes += 1; return { onload: null, onerror: null,
      set src(value) { if (value) this.onload(); } }; }
  };
  page.createSelectorQuery = () => ({ select() { return this; }, fields() { return this; },
    exec(callback) { callback([{ node: canvas }]); } });
  page.data.images = [{ path: "source.jpg", width, height }];
  page.data.stitchDirection = "horizontal";
  page.startPhotoGrid();
  assert.equal(page.data.gridMode, true);
  assert.equal(page.data.gridUnlocked, false);
  await page.renderOverview();
  assert.equal(page.data.previewPath, "grid-1.png");
  assert.equal(snapshots, 1);
  await page.confirmStitch();
  assert.equal(page.data.state, "complete");
  assert.equal(page.data.gridUnlocked, true);
  assert.equal(page.data.resultPaths.length, 9);
  assert.equal(new Set(page.data.resultPaths).size, 9);
  assert.equal(page.data.resultPath, "");
  assert.equal(decodes, 2, "预览和九张导出各只解码原图一次");
  const tileSize = Math.ceil(Math.max(width, height) / 3);
  assert.deepEqual([page.data.resultWidth, page.data.resultHeight], [tileSize, tileSize]);
  assert.match(toasts[0], /本次免费/);
  const tileDraws = draws.slice(-9);
  const fit = tileSize * 3 / Math.max(width, height);
  tileDraws.forEach((draw, i) => {
    assert.deepEqual(draw.slice(1, 5), [0, 0, width, height]);
    assert.equal(draw[5] + (i % 3) * tileSize, (tileSize * 3 - width * fit) / 2);
    assert.equal(draw[6] + Math.floor(i / 3) * tileSize, (tileSize * 3 - height * fit) / 2);
    assert.equal(draw[7], width * fit);
    assert.equal(draw[8], height * fit);
  });
  for (const draw of draws) assert.ok(Math.abs(draw[3] / draw[4] - draw[7] / draw[8]) < 0.00001);
 }
});

test("宫格提前关闭广告不导出；观看完成后失败重试沿用权益，普通拼接不请求广告", async () => {
  for (const ended of [false, true]) {
    let close;
    let ads = 0;
    let exports = 0;
    const { page } = loadPage({
      showToast() {},
      createWorker() { return { onMessage() {}, onError() {}, postMessage() {}, terminate() {} }; },
      createRewardedVideoAd() {
        ads += 1;
        return { async load() {}, async show() {}, destroy() {},
          onClose(fn) { close = fn; }, offClose() {}, onError() {}, offError() {} };
      }
    }, "adunit-test");
    page.exportResult = async () => {
      exports += 1;
      if (exports === 1 && page.data.gridMode) page.showError(new Error("设备暂时导出失败"));
      else page.setData({ state: "complete" });
    };
    const original = page.data.images;
    page.data.images = original.slice(0, 1);
    page.startPhotoGrid();
    const first = page.confirmStitch();
    await page.confirmStitch();
    await new Promise(setImmediate);
    assert.equal(ads, 1);
    close({ isEnded: ended });
    await first;
    assert.equal(page.data.adBusy, false);
    if (!ended) {
      assert.equal(page.data.state, "preview");
      assert.equal(exports, 0);
      assert.equal(page.data.gridUnlocked, false);
    } else {
      assert.equal(page.data.state, "error");
      assert.equal(page.data.gridUnlocked, true);
      page.retryFromError();
      await page.confirmStitch();
      assert.equal(page.data.state, "complete");
      assert.equal(exports, 2);
      assert.equal(ads, 1);
    }
    page.returnToSelection();
    page.data.images = original;
    page.stitchFullImages();
    await page.confirmStitch();
    assert.equal(ads, 1);
    assert.equal(page.data.state, "complete");
  }
});

test("切图只接受 1 张，离开任务时迟到的广告结果不解锁或导出", async () => {
  let close;
  const { page } = loadPage({
    showToast() {},
    createWorker() { return { onMessage() {}, onError() {}, postMessage() {}, terminate() {} }; },
    createRewardedVideoAd() { return { async load() {}, async show() {}, destroy() {},
      onClose(fn) { close = fn; }, offClose() {}, onError() {}, offError() {} }; }
  }, "adunit-test");
  const original = page.data.images;
  for (const count of [0, 2, 10]) {
    page.data.images = Array.from({ length: count }, () => original[0]);
    page.startPhotoGrid();
    assert.equal(page.data.state, "select");
  }
  page.data.images = original.slice(0, 1);
  page.startPhotoGrid();
  const request = page.confirmStitch();
  await new Promise(setImmediate);
  page.returnToSelection();
  close({ isEnded: true });
  await request;
  assert.equal(page.data.state, "select");
  assert.equal(page.data.gridUnlocked, false);
});

test("九图中途导出失败或取消会清理本轮临时文件，并保留源图直到快照结束", async () => {
  for (const cancel of [false, true]) {
    let snapshots = 0;
    let released = false;
    const removed = [];
    const { exportPhotoGridTiles, buildPhotoGridPlan } = loadPage({
      canvasToTempFilePath({ success, fail }) {
        assert.equal(released, false);
        snapshots += 1;
        if (!cancel && snapshots === 4) fail({ errMsg: "设备导出失败" });
        else success({ tempFilePath: `tile-${snapshots}` });
      },
      getFileSystemManager() { return { unlink({ filePath }) { removed.push(filePath); } }; }
    });
    const canvas = {
      getContext() { return { fillRect() {}, drawImage() {} }; },
      createImage() { return { onload: null, onerror: null,
        set src(value) { if (value) this.onload(); else released = true; } }; }
    };
    const images = [{ path: "source", width: 1000, height: 800 }];
    await assert.rejects(exportPhotoGridTiles(canvas, images, buildPhotoGridPlan(images), {},
      () => !cancel || snapshots < 3));
    assert.deepEqual(removed, ["tile-1", "tile-2", "tile-3"]);
    assert.equal(released, true);
  }
});

test("九图保存串行执行，拒绝授权后从第4张继续，重复点击不重复保存或请求广告", async () => {
  let failOnce = true;
  let modal;
  const saved = [];
  const { page } = loadPage({
    saveImageToPhotosAlbum({ filePath, success, fail }) {
      if (filePath === "tile-4" && failOnce) { failOnce = false; fail({ errMsg: "save:fail auth deny" }); }
      else { saved.push(filePath); success(); }
    },
    showModal(options) { modal = options; }, showToast() {},
    createRewardedVideoAd() { throw Error("保存不得请求广告"); }
  });
  page.data.gridMode = true;
  page.data.state = "complete";
  page.data.resultPaths = Array.from({ length: 9 }, (_, i) => `tile-${i + 1}`);
  const first = page.saveGridResults();
  await page.saveGridResults();
  await first;
  assert.equal(page.data.savedGridCount, 3);
  assert.match(modal.content, /3\/9/);
  assert.equal(page.data.savingResult, false);
  await page.saveGridResults();
  await page.saveGridResults();
  assert.equal(page.data.savedGridCount, 9);
  assert.deepEqual(saved, Array.from({ length: 9 }, (_, i) => `tile-${i + 1}`));
});

test("直接拼接完整保留正方形与横图，按比例统一宽度或高度后导出一张图", async () => {
  for (const direction of ["vertical", "horizontal"]) {
    const draws = [];
    const { page } = loadPage({
      canvasToTempFilePath({ success }) { success({ tempFilePath: "photos.png" }); },
      createWorker() { throw new Error("直接拼图不应启动重叠分析"); }
    });
    const canvas = {
      getContext() { return { fillRect() {}, drawImage(...args) { draws.push(args); } }; },
      createImage() { return { width: 0, height: 0, onload: null, onerror: null,
        set src(value) { if (value) this.onload(); } }; }
    };
    page.createSelectorQuery = () => ({ select() { return this; }, fields() { return this; },
      exec(callback) { callback([{ node: canvas }]); } });
    page.data.stitchDirection = direction;
    page.data.images = [[1080, 1080], [1280, 768], [1280, 768]].map(([width, height], i) =>
      ({ id: String(i), path: `${i}.jpg`, width, height }));
    page.stitchFullImages();
    assert.equal(page.data.state, "preview");
    assert.equal(page.data.fullImageStitch, true);
    assert.equal(page.data.autoRemovedCount, 0);
    let exporting;
    const exportResult = page.exportResult.bind(page);
    page.exportResult = () => { exporting = exportResult(); };
    page.confirmStitch();
    await exporting;
    assert.equal(page.data.state, "complete");
    assert.equal(page.data.resultPath, "photos.png");
    assert.deepEqual([page.data.resultWidth, page.data.resultHeight], direction === "vertical" ? [1080, 2376] : [4680, 1080]);
    assert.deepEqual(draws.map(args => args.slice(1, 5)), [[0, 0, 1080, 1080], [0, 0, 1280, 768], [0, 0, 1280, 768]]);
    for (const draw of draws) assert.ok(Math.abs(draw[7] / draw[8] - draw[3] / draw[4]) < 0.00001);
  }
});

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

test("99 张上下和左右拼接都能导出一张图，允许短边小于 480 且保持尺寸上限", async () => {
  for (const direction of ["vertical", "horizontal"]) {
    let saves = 0;
    const { page, buildStitchPlan } = loadPage({
      canvasToTempFilePath({ success }) { success({ tempFilePath: "output.png" }); },
      getFileSystemManager() { return { unlink({ complete }) { complete(); } }; },
      saveImageToPhotosAlbum({ filePath, success }) { assert.equal(filePath, "output.png"); saves += 1; success(); },
      showToast() {}
    });
    const canvas = {
      width: 0, height: 0,
      getContext() { return { fillRect() {}, drawImage() {} }; },
      createImage() { return { width: 0, height: 0, onload: null, onerror: null,
        set src(value) { if (value) this.onload(); } }; }
    };
    page.createSelectorQuery = () => ({ select() { return this; }, fields() { return this; },
      exec(callback) { callback([{ node: canvas }]); } });
    page.data.stitchDirection = direction;
    page.data.images = Array.from({ length: 99 }, (_, i) => ({ id: String(i), path: `${i}.png`,
      width: direction === "vertical" ? 1080 : 2400, height: direction === "vertical" ? 2400 : 1080 }));
    page.data.seams = Array.from({ length: 98 }, (_, pairIndex) => ({ pairIndex, mode: "auto",
      prevCropEndRatio: 0.75, nextCropStartRatio: 0.25 }));
    const plan = buildStitchPlan(page.data.images, page.data.seams, 1, direction);
    await page.exportResult();
    assert.equal(page.data.state, "complete");
    assert.equal(page.data.resultPath, "output.png");
    assert.deepEqual([page.data.resultWidth, page.data.resultHeight], [plan.outputWidth, plan.outputHeight]);
    assert.ok(Math.min(plan.outputWidth, plan.outputHeight) < 480);
    assert.ok(Math.max(plan.outputWidth, plan.outputHeight) <= 32767);
    assert.ok(plan.outputWidth * plan.outputHeight <= 16_000_000);
    assert.equal(page.data.resultWasScaled, true);
    page.saveResult();
    assert.equal(saves, 1);
  }
});

test("99 张超长图导出失败最多重试三次，保留选图并提示失败", async () => {
  let attempts = 0;
  const { page } = loadPage({
    canvasToTempFilePath({ fail }) { attempts += 1; fail({ errMsg: "图片尺寸超过设备限制" }); }
  });
  const canvas = {
    getContext() { return { fillRect() {}, drawImage() {} }; },
    createImage() { return { width: 0, height: 0, onload: null, onerror: null,
      set src(value) { if (value) this.onload(); } }; }
  };
  page.createSelectorQuery = () => ({ select() { return this; }, fields() { return this; },
    exec(callback) { callback([{ node: canvas }]); } });
  page.data.images = Array.from({ length: 99 }, (_, i) => ({ id: String(i), path: `${i}.png`,
    width: 1080, height: 2400 }));
  page.data.seams = Array.from({ length: 98 }, (_, pairIndex) => ({ pairIndex, mode: "auto",
    prevCropEndRatio: 0.75, nextCropStartRatio: 0.25 }));
  await page.exportResult();
  assert.equal(attempts, 3);
  assert.equal(page.data.state, "error");
  assert.equal(page.data.errorMessage, "图片尺寸超过设备限制");
  assert.equal(page.data.images.length, 99);
  assert.equal(page.data.resultPath, "");
});
