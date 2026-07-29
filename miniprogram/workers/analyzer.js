"use strict";

const { analyzePairWithOrderHint } = require("./stitch-core");

let cancelledJobId = "";

worker.onMessage((message) => {
  const { type, jobId } = message;
  if (type === "CANCEL") {
    cancelledJobId = jobId;
    return;
  }
  if (type !== "ANALYZE_PAIR" || cancelledJobId === jobId) return;

  try {
    worker.postMessage({
      type: "PROGRESS",
      jobId,
      pairIndex: message.pairIndex,
      progress: 0.15
    });
    const result = analyzePairWithOrderHint(
      message.left,
      message.right,
      message.pairIndex,
      message.direction || "vertical"
    );
    if (cancelledJobId === jobId) return;
    worker.postMessage({
      type: "PAIR_RESULT",
      jobId,
      pairIndex: message.pairIndex,
      result
    });
  } catch (error) {
    worker.postMessage({
      type: "ERROR",
      jobId,
      pairIndex: message.pairIndex,
      message: error instanceof Error ? error.message : "图片分析失败"
    });
  }
});
