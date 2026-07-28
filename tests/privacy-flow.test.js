"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const ts = require("typescript");

function loadIndexPage(wx) {
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
