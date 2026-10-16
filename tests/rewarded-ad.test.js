"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");

function loadAd(wx, id = "adunit-test", timers = { setTimeout, clearTimeout }) {
  const filename = path.join(__dirname, "../miniprogram/services/rewarded-ad.ts");
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, wx, ...timers,
    require() { return { GRID_REWARDED_AD_UNIT_ID: id }; } });
  return module.exports;
}

function fakeAd() {
  const events = [];
  const listeners = {};
  return { events, listeners,
    async load() { events.push("load"); }, async show() { events.push("show"); },
    destroy() { events.push("destroy"); },
    onClose(fn) { listeners.close = fn; }, offClose(fn) { assert.equal(listeners.close, fn); listeners.close = null; },
    onError(fn) { listeners.error = fn; }, offError(fn) { assert.equal(listeners.error, fn); listeners.error = null; }
  };
}

test("只有完整观看才返回 completed；提前关闭及缺少观看状态均不发放奖励", async () => {
  for (const result of [{ isEnded: true }, { isEnded: false }, undefined]) {
    const ad = fakeAd();
    const service = loadAd({ createRewardedVideoAd(options) { assert.equal(options.adUnitId, "adunit-test"); return ad; } });
    const request = service.watchGridRewardedAd();
    await new Promise(setImmediate);
    assert.deepEqual(ad.events, ["load", "show"]);
    const close = ad.listeners.close;
    close(result);
    close({ isEnded: true });
    assert.equal(await request, result?.isEnded ? "completed" : "cancelled");
    assert.deepEqual(ad.events, ["load", "show", "destroy"]);
    assert.equal(ad.listeners.close, null);
    assert.equal(ad.listeners.error, null);
  }
});

test("无接口、缺广告位、创建失败、加载失败、展示失败和错误事件均返回不可用", async () => {
  assert.equal(await loadAd({}).watchGridRewardedAd(), "unavailable");
  assert.equal(await loadAd({ createRewardedVideoAd() { throw Error("should not create"); } }, "").watchGridRewardedAd(), "unavailable");
  assert.equal(await loadAd({ createRewardedVideoAd() { throw Error("invalid unit"); } }).watchGridRewardedAd(), "unavailable");
  for (const phase of ["load", "show", "error"]) {
    const ad = fakeAd();
    if (phase !== "error") ad[phase] = async () => { throw Error(phase); };
    const service = loadAd({ createRewardedVideoAd() { return ad; } });
    const request = service.watchGridRewardedAd();
    if (phase === "error") { await new Promise(setImmediate); ad.listeners.error(); }
    assert.equal(await request, "unavailable");
    assert.equal(ad.events.at(-1), "destroy");
  }
});

test("重复请求不再展示广告；离开任务取消未完成请求，迟到的加载不会展示", async () => {
  const ad = fakeAd();
  const service = loadAd({ createRewardedVideoAd() { return ad; } });
  const pending = service.watchGridRewardedAd();
  assert.equal(await service.watchGridRewardedAd(), "cancelled");
  service.cancelRewardedAd();
  assert.equal(await pending, "cancelled");
  await new Promise(setImmediate);
  assert.deepEqual(ad.events, ["load", "destroy"]);
});

test("广告加载没有返回时有界超时，不阻断本次导出", async () => {
  let expire;
  const ad = fakeAd();
  ad.load = () => new Promise(() => {});
  const service = loadAd({ createRewardedVideoAd() { return ad; } }, "adunit-test", {
    setTimeout(fn, ms) { assert.equal(ms, 15000); expire = fn; return 1; }, clearTimeout() {}
  });
  const request = service.watchGridRewardedAd();
  await new Promise(setImmediate);
  expire();
  assert.equal(await request, "unavailable");
  assert.deepEqual(ad.events, ["destroy"]);
});
