"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const ts = require("typescript");

function loadIndexPage(wx, canvasOverrides = {}) {
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
    wx,
    console,
    setTimeout,
    clearTimeout,
    require(request) {
      if (request.endsWith("/canvas")) {
        return {
          createAnalysisImage() {},
          renderPlanToCanvas() {},
          releaseCanvasImages() {},
          canvasToPng() {},
          ...canvasOverrides
        };
      }
      if (request.endsWith("/stitch-plan")) {
        return { buildStitchPlan() {}, MIN_OUTPUT_WIDTH: 320 };
      }
      if (request.endsWith("/source-validation")) {
        return require("../miniprogram/lib/source-validation");
      }
      throw new Error(`Unexpected import: ${request}`);
    }
  });

  assert.ok(definition, "页面应完成注册");
  const page = {
    ...definition,
    data: { ...definition.data },
    setData(patch) {
      Object.assign(this.data, patch);
    }
  };
  return page;
}

test("首次选图需要隐私授权时先显示授权界面，不直接打开相册", () => {
  let chooseMediaCalls = 0;
  const page = loadIndexPage({
    getPrivacySetting({ success }) {
      success({ needAuthorization: true, privacyContractName: "《青缝长图拼接隐私保护指引》" });
    },
    chooseMedia() {
      chooseMediaCalls += 1;
    }
  });

  page.chooseImages();

  assert.equal(page.data.showPrivacy, true);
  assert.equal(page.data.privacyContractName, "《青缝长图拼接隐私保护指引》");
  assert.equal(chooseMediaCalls, 0);
});

test("同意隐私授权后继续打开相册", () => {
  let chooseMediaCalls = 0;
  const page = loadIndexPage({
    chooseMedia() {
      chooseMediaCalls += 1;
    }
  });

  page.data.showPrivacy = true;
  page.handleAgreePrivacyAuthorization();

  assert.equal(page.data.showPrivacy, false);
  assert.equal(chooseMediaCalls, 1);
});

test("拒绝隐私授权后关闭授权界面并给出反馈", () => {
  const toasts = [];
  const page = loadIndexPage({
    showToast(options) {
      toasts.push(options);
    }
  });

  page.data.showPrivacy = true;
  page.handlePrivacyDisagree();

  assert.equal(page.data.showPrivacy, false);
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].icon, "none");
});

test("选图接口失败时给出反馈，用户主动取消除外", () => {
  const toasts = [];
  let chooseMediaOptions = null;
  const page = loadIndexPage({
    chooseMedia(options) {
      chooseMediaOptions = options;
    },
    showToast(options) {
      toasts.push(options);
    }
  });

  page.openMediaPicker();
  chooseMediaOptions.fail({ errMsg: "chooseMedia:fail permission denied" });
  chooseMediaOptions.fail({ errMsg: "chooseMedia:fail cancel" });

  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].icon, "none");
});

test("页面包含微信隐私授权同意按钮且基础库满足接口要求", () => {
  const wxml = fs.readFileSync(path.join(__dirname, "../miniprogram/pages/index/index.wxml"), "utf8");
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "../project.config.json"), "utf8"));
  const [major, minor, patch] = config.libVersion.split(".").map(Number);

  assert.match(wxml, /open-type="agreePrivacyAuthorization"/);
  assert.match(wxml, /bindagreeprivacyauthorization="handleAgreePrivacyAuthorization"/);
  assert.ok(
    major > 2 || (major === 2 && (minor > 32 || (minor === 32 && patch >= 3))),
    `基础库 ${config.libVersion} 低于隐私授权接口要求`
  );
});

test("分批选图累计到 99 张，单次不超过 20 张；忙碌和满额时不会再打开相册", async () => {
  let picker;
  let calls = 0;
  const page = loadIndexPage({
    chooseMedia(options) { picker = options; calls += 1; },
    getImageInfo({ success }) { success({ width: 1080, height: 2400 }); },
    showToast() {}
  });
  for (const count of [20, 20, 20, 20, 19]) {
    page.openMediaPicker();
    assert.equal(picker.count, count);
    page.openMediaPicker();
    await picker.success({ tempFiles: Array.from({ length: count + 1 }, (_, index) => ({ tempFilePath: `batch-${calls}-${index}.png` })) });
    assert.equal(page.data.selectingImages, false);
  }
  assert.equal(calls, 5);
  assert.equal(page.data.images.length, 99);
  assert.deepEqual(Array.from(page.data.images, image => image.order), Array.from({ length: 99 }, (_, i) => i));
  page.openMediaPicker();
  page.chooseImages();
  assert.equal(calls, 5);
});

test("取消选图或图片方向不符后解除忙碌状态，已有图片保留", async () => {
  let picker;
  const page = loadIndexPage({
    chooseMedia(options) { picker = options; },
    getImageInfo({ success }) { success({ width: 2400, height: 1080 }); },
    showToast() {}
  });
  page.data.images = [{ id: "existing" }];
  page.openMediaPicker();
  picker.fail({ errMsg: "chooseMedia:fail cancel" });
  assert.equal(page.data.selectingImages, false);
  page.openMediaPicker();
  await picker.success({ tempFiles: [{ tempFilePath: "landscape.png" }] });
  assert.equal(page.data.selectingImages, false);
  assert.equal(page.data.images.length, 1);
  assert.equal(page.data.state, "error");
});

test("99 张按相邻两张交替读取和分析，产生 98 个接缝", async () => {
  let onMessage;
  const events = [];
  const page = loadIndexPage({
    createWorker() {
      return {
        onMessage(callback) { onMessage = callback; }, onError() {}, terminate() {},
        postMessage(message) {
          if (message.type !== "ANALYZE_PAIR") return;
          events.push(`pair:${message.pairIndex}`);
          assert.equal(message.left.id, String(message.pairIndex));
          assert.equal(message.right.id, String(message.pairIndex + 1));
          onMessage({ type: "PAIR_RESULT", jobId: message.jobId, pairIndex: message.pairIndex,
            result: { mode: "manual", prevCropEndRatio: 1, nextCropStartRatio: 0 } });
        }
      };
    }
  }, {
    async createAnalysisImage(image) { events.push(`read:${image.id}`); return { id: image.id }; }
  });
  page.data.images = Array.from({ length: 99 }, (_, index) => ({ id: String(index), width: 1080, height: 2400 }));
  await page.startAnalysis();
  assert.equal(page.data.seams.length, 98);
  assert.equal(page.data.state, "manual");
  assert.deepEqual(events.slice(0, 5), ["read:0", "read:1", "pair:0", "read:2", "pair:1"]);
  assert.equal(events.at(-1), "pair:97");
});

test("读取图片期间取消分析，迟到的读取结果不会继续调用 Worker 或修改页面", async () => {
  let finishRead;
  let pairs = 0;
  const page = loadIndexPage({
    createWorker() {
      return { onMessage() {}, onError() {}, terminate() {},
        postMessage(message) { if (message.type === "ANALYZE_PAIR") pairs += 1; } };
    }
  }, { createAnalysisImage() { return new Promise(resolve => { finishRead = resolve; }); } });
  page.data.images = [{ id: "0" }, { id: "1" }];
  const analysis = page.startAnalysis();
  page.cancelAnalysis();
  finishRead({ id: "0" });
  await analysis;
  assert.equal(pairs, 0);
  assert.equal(page.data.state, "select");
  assert.equal(page.data.seams.length, 0);
});
