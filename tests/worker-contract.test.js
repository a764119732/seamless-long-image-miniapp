"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("CANCEL 后忽略同一 jobId 的分析任务", () => {
  let handler = null;
  const messages = [];
  global.worker = {
    onMessage(callback) {
      handler = callback;
    },
    postMessage(message) {
      messages.push(message);
    }
  };

  const modulePath = require.resolve("../miniprogram/workers/analyzer");
  delete require.cache[modulePath];
  require(modulePath);
  assert.equal(typeof handler, "function");

  handler({ type: "CANCEL", jobId: "cancelled" });
  handler({ type: "ANALYZE_PAIR", jobId: "cancelled", pairIndex: 0, left: {}, right: {} });
  assert.deepEqual(messages, []);
  delete global.worker;
});
