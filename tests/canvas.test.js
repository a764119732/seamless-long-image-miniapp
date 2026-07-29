"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const ts = require("typescript");

function loadCanvasModule() {
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
    wx: {}
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
