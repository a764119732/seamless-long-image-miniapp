"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const ts = require("typescript");

function loadCanvasModule(wx = {}) {
  const filename = path.join(__dirname, "../miniprogram/services/canvas.ts");
  const source = fs.readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    }
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    exports: module.exports,
    module,
    require,
    setTimeout,
    wx
  });
  return module.exports;
}

function createFakeCanvas() {
  const draws = [];
  const context = {
    fillStyle: "",
    fillRect() {},
    drawImage(...args) {
      draws.push(args.slice(1));
    }
  };
  return {
    canvas: {
      width: 0,
      height: 0,
      getContext() {
        return context;
      },
      createImage() {
        let source = "";
        return {
          width: 0,
          height: 0,
          onload: null,
          onerror: null,
          get src() {
            return source;
          },
          set src(value) {
            source = value;
            if (value && this.onload) this.onload();
          }
        };
      }
    },
    draws
  };
}

test("横向画布按从左到右绘制裁切片段", async () => {
  const { renderPlanToCanvas } = loadCanvasModule();
  const { canvas, draws } = createFakeCanvas();
  const images = [
    { path: "one.png", width: 1600, height: 900 },
    { path: "two.png", width: 1600, height: 900 }
  ];
  const plan = {
    direction: "horizontal",
    outputWidth: 2400,
    outputHeight: 900,
    scale: 1,
    segments: [
      {
        imageIndex: 0,
        sourceX: 0,
        sourceY: 0,
        sourceWidth: 1200,
        sourceHeight: 900,
        normalizedWidth: 1200,
        normalizedHeight: 900
      },
      {
        imageIndex: 1,
        sourceX: 400,
        sourceY: 0,
        sourceWidth: 1200,
        sourceHeight: 900,
        normalizedWidth: 1200,
        normalizedHeight: 900
      }
    ]
  };

  await renderPlanToCanvas(canvas, images, plan);

  assert.deepEqual(JSON.parse(JSON.stringify(draws)), [
    [0, 0, 1200, 900, 0, 0, 1200, 900],
    [400, 0, 1200, 900, 1200, 0, 1200, 900]
  ]);
  assert.equal(canvas.width, 2400);
  assert.equal(canvas.height, 900);
});

test("解码失败时通过本机压缩重试一次，释放失败的图片对象", async () => {
  const attempts = [];
  const created = [];
  const { canvas } = createFakeCanvas();
  canvas.createImage = () => {
    const image = {
      width: 1000, height: 2000, onload: null, onerror: null,
      set src(value) {
        if (!value) return;
        attempts.push(value);
        if (value === "original.jpg") this.onerror(new Error("decode failed"));
        else this.onload();
      }
    };
    created.push(image);
    return image;
  };
  let compressionCalls = 0;
  const { loadCanvasImage } = loadCanvasModule({
    getImageInfo({ success }) { success({ width: 2000, height: 4000 }); },
    compressImage(options) {
      compressionCalls += 1;
      assert.equal(options.src, "original.jpg");
      assert.equal(options.quality, 100);
      assert.ok(options.compressedWidth <= 1024);
      options.success({ tempFilePath: "compatible.jpg" });
    }
  });
  const image = await loadCanvasImage(canvas, "original.jpg");
  assert.deepEqual(attempts, ["original.jpg", "compatible.jpg"]);
  assert.equal(compressionCalls, 1);
  assert.equal(created[0].onload, null);
  assert.equal(created[0].onerror, null);
  assert.equal(image, created[1]);
});

test("普通图片直接解码，不降低清晰度；兼容处理失败后明确报错且不循环重试", async () => {
  let compressions = 0;
  const api = {
    getImageInfo({ success }) { success({ width: 1000, height: 2000 }); },
    compressImage({ fail }) { compressions += 1; fail(); }
  };
  const { loadCanvasImage } = loadCanvasModule(api);
  const { canvas } = createFakeCanvas();
  const image = await loadCanvasImage(canvas, "normal.png");
  assert.equal(image.src, "normal.png");
  assert.equal(compressions, 0);
  const failures = [];
  canvas.createImage = () => {
    const failed = { onload: null, onerror: null, set src(value) { if (value) this.onerror(); } };
    failures.push(failed);
    return failed;
  };
  await assert.rejects(loadCanvasImage(canvas, "unsupported.png"), /图片解码失败/);
  assert.equal(compressions, 1);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].onerror, null);
});

test("兼容解码缩小图片后，导出裁切坐标仍对应原图的同一范围", async () => {
  const { renderPlanToCanvas } = loadCanvasModule();
  const { canvas, draws } = createFakeCanvas();
  const createImage = canvas.createImage;
  canvas.createImage = () => {
    const image = createImage();
    image.width = 500;
    image.height = 1000;
    return image;
  };
  await renderPlanToCanvas(canvas, [{ path: "smaller.jpg", width: 1000, height: 2000 }], {
    direction: "vertical", outputWidth: 1000, outputHeight: 1000, scale: 1,
    segments: [{ imageIndex: 0, sourceX: 0, sourceY: 500, sourceWidth: 1000,
      sourceHeight: 1000, normalizedWidth: 1000, normalizedHeight: 1000 }]
  });
  assert.deepEqual(draws[0], [0, 250, 500, 500, 0, 0, 1000, 1000]);
});

test("缩小导出时累计接缝坐标正好覆盖画布，不累计舍入丢失末端", async () => {
  const { renderPlanToCanvas } = loadCanvasModule();
  const { canvas, draws } = createFakeCanvas();
  await renderPlanToCanvas(canvas, [{ path: "test.png", width: 1000, height: 1000 }], {
    direction: "vertical", outputWidth: 333, outputHeight: 1000, scale: 0.3336,
    segments: Array.from({ length: 3 }, () => ({ imageIndex: 0, sourceX: 0, sourceY: 0,
      sourceWidth: 1000, sourceHeight: 1000, normalizedWidth: 1000, normalizedHeight: 1000 }))
  });
  assert.equal(draws.reduce((sum, args) => sum + args[7], 0), canvas.height);
  assert.equal(draws.at(-1)[5] + draws.at(-1)[7], canvas.height);
  assert.equal(draws[0][6], canvas.width);
});

test("分析像素读取失败也释放解码图片及离屏画布", async () => {
  const { canvas } = createFakeCanvas();
  let image;
  const createImage = canvas.createImage;
  canvas.createImage = () => (image = createImage());
  canvas.getContext = () => ({
    clearRect() {}, drawImage() {},
    getImageData() { throw new Error("read failed"); }
  });
  const { createAnalysisImage } = loadCanvasModule({ createOffscreenCanvas: () => canvas });
  await assert.rejects(createAnalysisImage({ id: "one", path: "one.png", width: 1000, height: 2000 }), /read failed/);
  assert.equal(image.src, "");
  assert.equal(image.onerror, null);
  assert.equal(canvas.width * canvas.height, 1);
});
