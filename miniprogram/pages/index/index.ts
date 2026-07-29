import {
  createAnalysisImage,
  renderPlanToCanvas,
  releaseCanvasImages,
  canvasToPng
} from "../../services/canvas";
import { buildStitchPlan, MIN_OUTPUT_SHORT_EDGE } from "../../services/stitch-plan";
import { validateSourceImage } from "../../lib/source-validation";

type PendingAnalysis = {
  resolve: (result: SeamDecision) => void;
  reject: (error: Error) => void;
};

const SHARE_TITLE = "青缝长图拼接｜连续截图自动去重复叠";
const SHARE_PATH = "/pages/index/index";
const SHARE_IMAGE = "/assets/share-card.png";

let analyzerWorker: WorkerLike | null = null;
let activeJobId = "";
let pendingAnalysis = new Map<number, PendingAnalysis>();
let analysisCache: AnalysisImage[] = [];
let editingOriginal: SeamDecision | null = null;

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getImageInfo(path: string): Promise<{ width: number; height: number; orientation?: string }> {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src: path,
      success: resolve,
      fail: () => reject(new Error("无法读取图片尺寸，请重新选择"))
    });
  });
}

function getCanvasNode(page: any, selector: string): Promise<CanvasLike> {
  return new Promise((resolve, reject) => {
    page
      .createSelectorQuery()
      .select(selector)
      .fields({ node: true, size: true })
      .exec((result: Array<{ node?: CanvasLike }>) => {
        const canvas = result[0]?.node;
        if (canvas) resolve(canvas);
        else reject(new Error("画布初始化失败，请重试"));
      });
  });
}

function canvasExport(canvas: CanvasLike, plan: StitchPlan, page: unknown): Promise<string> {
  return renderPlanToCanvas(canvas, (page as any).data.images, plan).then(async (retainedImages) => {
    try {
      return await canvasToPng(canvas, plan.outputWidth, plan.outputHeight, page);
    } finally {
      releaseCanvasImages(retainedImages);
    }
  });
}

Page({
  data: {
    state: "select" as AppState,
    statusBarHeight: 24,
    stitchDirection: "vertical" as StitchDirection,
    images: [] as SourceImage[],
    seams: [] as SeamDecision[],
    confirmedManualPairs: [] as number[],
    progress: 0,
    progressText: "正在准备图片",
    currentSeamIndex: 0,
    manualPrevPercent: 100,
    manualNextPercent: 0,
    manualLinkedPercent: 50,
    previewCanvasWidth: 228,
    previewCanvasHeight: 520,
    previewPath: "",
    autoRemovedCount: 0,
    resultPath: "",
    resultWidth: 0,
    resultHeight: 0,
    resultWasScaled: false,
    errorMessage: "",
    showPrivacy: false,
    privacyContractName: "《青缝长图拼接用户隐私保护指引》"
  },

  onLoad(this: any) {
    const windowInfo = wx.getWindowInfo();
    this.setData({ statusBarHeight: windowInfo.safeArea?.top || windowInfo.statusBarHeight || 24 });
    this.ensureWorker();
  },

  onUnload(this: any) {
    this.releaseTask(true);
  },

  onShareAppMessage() {
    return {
      title: SHARE_TITLE,
      path: SHARE_PATH,
      imageUrl: SHARE_IMAGE
    };
  },

  onShareTimeline() {
    return {
      title: SHARE_TITLE,
      query: "",
      imageUrl: SHARE_IMAGE
    };
  },

  ensureWorker(this: any) {
    if (analyzerWorker) return;
    analyzerWorker = wx.createWorker("workers/analyzer.js");
    analyzerWorker.onMessage((message: WorkerResponse) => {
      if (message.jobId !== activeJobId) return;
      if (message.type === "PROGRESS") {
        const pairProgress = (message.pairIndex + message.progress) / Math.max(1, this.data.images.length - 1);
        this.setData({ progress: Math.round(35 + pairProgress * 60) });
        return;
      }
      if (message.type === "PAIR_RESULT") {
        const pending = pendingAnalysis.get(message.pairIndex);
        pendingAnalysis.delete(message.pairIndex);
        pending?.resolve(message.result);
        return;
      }
      if (message.type === "ERROR") {
        const pending = pendingAnalysis.get(message.pairIndex ?? -1);
        pendingAnalysis.delete(message.pairIndex ?? -1);
        pending?.reject(new Error(message.message));
      }
    });
    analyzerWorker.onError((error) => {
      const failure = new Error(error.message || "图片分析进程异常中止");
      pendingAnalysis.forEach((pending) => pending.reject(failure));
      pendingAnalysis.clear();
      analyzerWorker?.terminate();
      analyzerWorker = null;
    });
  },

  chooseImages(this: any) {
    const remaining = 20 - this.data.images.length;
    if (remaining <= 0) {
      wx.showToast({ title: "最多选择 20 张", icon: "none" });
      return;
    }
    wx.getPrivacySetting({
      success: (result: { needAuthorization: boolean; privacyContractName?: string }) => {
        if (result.needAuthorization) {
          this.setData({
            showPrivacy: true,
            privacyContractName: result.privacyContractName || this.data.privacyContractName
          });
          return;
        }
        this.openMediaPicker();
      },
      fail: () => {
        wx.showToast({ title: "暂时无法确认隐私授权，请重试", icon: "none" });
      }
    });
  },

  handleAgreePrivacyAuthorization(this: any) {
    this.setData({ showPrivacy: false });
    this.openMediaPicker();
  },

  handlePrivacyDisagree(this: any) {
    this.setData({ showPrivacy: false });
    wx.showToast({ title: "同意隐私指引后才能选择图片", icon: "none" });
  },

  openPrivacyContract() {
    wx.openPrivacyContract({
      fail: () => wx.showToast({ title: "隐私指引暂时无法打开", icon: "none" })
    });
  },

  openMediaPicker(this: any) {
    const remaining = 20 - this.data.images.length;
    if (remaining <= 0) {
      wx.showToast({ title: "最多选择 20 张", icon: "none" });
      return;
    }
    wx.chooseMedia({
      count: remaining,
      mediaType: ["image"],
      sourceType: ["album"],
      sizeType: ["original"],
      success: async (result: { tempFiles: Array<{ tempFilePath: string }> }) => {
        try {
          const additions: SourceImage[] = [];
          for (const file of result.tempFiles) {
            const info = await getImageInfo(file.tempFilePath);
            validateSourceImage(info, this.data.stitchDirection);
            additions.push({
              id: createId("image"),
              path: file.tempFilePath,
              thumbPath: file.tempFilePath,
              width: info.width,
              height: info.height,
              orientation: info.orientation || "up",
              order: this.data.images.length + additions.length
            });
          }
          const images = [...this.data.images, ...additions].map((image, order) => ({ ...image, order }));
          this.setData({ images, errorMessage: "" });
        } catch (error) {
          this.showError(error);
        }
      },
      fail: (error: { errMsg?: string }) => {
        const message = error.errMsg || "";
        if (message.includes("cancel")) return;
        if (message.includes("privacy permission")) {
          this.setData({ showPrivacy: true });
          wx.showToast({ title: "请先同意隐私保护指引", icon: "none" });
          return;
        }
        wx.showToast({ title: "无法打开相册，请稍后重试", icon: "none" });
      }
    });
  },

  setStitchDirection(this: any, event: any) {
    const direction = event.currentTarget.dataset.direction as StitchDirection;
    if (direction !== "vertical" && direction !== "horizontal") return;
    if (direction === this.data.stitchDirection) return;
    if (this.data.images.length) {
      wx.showToast({ title: "请先删除已选图片再切换方向", icon: "none" });
      return;
    }
    this.setData({ stitchDirection: direction, errorMessage: "" });
  },

  removeImage(this: any, event: any) {
    const index = Number(event.currentTarget.dataset.index);
    const images = this.data.images.filter((_: SourceImage, itemIndex: number) => itemIndex !== index);
    this.setData({ images: images.map((image: SourceImage, order: number) => ({ ...image, order })) });
  },

  moveImage(this: any, event: any) {
    const index = Number(event.currentTarget.dataset.index);
    const direction = Number(event.currentTarget.dataset.direction);
    const target = index + direction;
    if (target < 0 || target >= this.data.images.length) return;
    const images = [...this.data.images];
    [images[index], images[target]] = [images[target], images[index]];
    this.setData({ images: images.map((image: SourceImage, order: number) => ({ ...image, order })) });
  },

  async startAnalysis(this: any) {
    if (this.data.images.length < 2) {
      wx.showToast({ title: "请至少选择 2 张截图", icon: "none" });
      return;
    }
    this.ensureWorker();
    activeJobId = createId("job");
    analysisCache = [];
    this.setData({
      state: "analyzing",
      progress: 2,
      progressText: "正在读取图片",
      seams: [],
      confirmedManualPairs: [],
      previewPath: "",
      errorMessage: ""
    });

    try {
      for (let index = 0; index < this.data.images.length; index += 1) {
        analysisCache.push(await createAnalysisImage(this.data.images[index]));
        this.setData({
          progress: Math.round(((index + 1) / this.data.images.length) * 32),
          progressText: `正在准备第 ${index + 1} / ${this.data.images.length} 张`
        });
      }

      const seams: SeamDecision[] = [];
      for (let pairIndex = 0; pairIndex < analysisCache.length - 1; pairIndex += 1) {
        this.setData({ progressText: `正在分析接缝 ${pairIndex + 1} / ${analysisCache.length - 1}` });
        seams.push(await this.analyzePair(pairIndex));
      }
      if (activeJobId === "") return;

      const firstManual = seams.findIndex((seam) => seam.mode === "manual");
      this.setData({
        seams,
        autoRemovedCount: seams.filter((seam) => seam.mode === "auto").length,
        progress: 100,
        currentSeamIndex: firstManual >= 0 ? firstManual : 0,
        state: firstManual >= 0 ? "manual" : "preview"
      });
      if (firstManual >= 0) this.beginSeamEdit(firstManual);
      else setTimeout(() => this.renderOverview(), 40);
    } catch (error) {
      this.showError(error);
    }
  },

  analyzePair(this: any, pairIndex: number): Promise<SeamDecision> {
    return new Promise((resolve, reject) => {
      if (!analyzerWorker) {
        reject(new Error("图片分析进程未启动"));
        return;
      }
      pendingAnalysis.set(pairIndex, { resolve, reject });
      analyzerWorker.postMessage({
        type: "ANALYZE_PAIR",
        jobId: activeJobId,
        pairIndex,
        left: analysisCache[pairIndex],
        right: analysisCache[pairIndex + 1],
        direction: this.data.stitchDirection
      } as WorkerRequest);
    });
  },

  cancelAnalysis(this: any) {
    if (activeJobId && analyzerWorker) {
      analyzerWorker.postMessage({ type: "CANCEL", jobId: activeJobId } as WorkerRequest);
    }
    pendingAnalysis.forEach((pending) => pending.reject(new Error("用户取消分析")));
    pendingAnalysis.clear();
    activeJobId = "";
    analysisCache = [];
    this.setData({ state: "select", progress: 0 });
  },

  beginSeamEdit(this: any, pairIndex: number) {
    const seam = this.data.seams[pairIndex];
    if (!seam) return;
    editingOriginal = { ...seam };
    this.setData({
      state: "manual",
      currentSeamIndex: pairIndex,
      manualPrevPercent: Math.round(seam.prevCropEndRatio * 100),
      manualNextPercent: Math.round(seam.nextCropStartRatio * 100),
      manualLinkedPercent: 50
    });
  },

  openCurrentSeam(this: any) {
    this.beginSeamEdit(this.data.currentSeamIndex);
  },

  onManualPrevChange(this: any, event: any) {
    this.setData({ manualPrevPercent: Number(event.detail.value) });
  },

  onManualNextChange(this: any, event: any) {
    this.setData({ manualNextPercent: Number(event.detail.value) });
  },

  onLinkedSeamChange(this: any, event: any) {
    if (!editingOriginal) return;
    const percent = Number(event.detail.value);
    const delta = ((percent - 50) / 50) * Math.max(0.02, editingOriginal.overlapRatio * 0.35);
    this.setData({
      manualLinkedPercent: percent,
      manualPrevPercent: Math.round(Math.min(98, Math.max(2, editingOriginal.prevCropEndRatio * 100 + delta * 100))),
      manualNextPercent: Math.round(Math.min(98, Math.max(0, editingOriginal.nextCropStartRatio * 100 + delta * 100)))
    });
  },

  confirmManual(this: any) {
    const pairIndex = this.data.currentSeamIndex;
    const seams = [...this.data.seams];
    const seam = seams[pairIndex];
    if (!seam) return;
    seams[pairIndex] = {
      ...seam,
      prevCropEndRatio: this.data.manualPrevPercent / 100,
      nextCropStartRatio: this.data.manualNextPercent / 100
    };
    const confirmed = Array.from(new Set([...this.data.confirmedManualPairs, pairIndex]));
    const nextManual = seams.findIndex((item, index) => item.mode === "manual" && !confirmed.includes(index));
    this.setData({ seams, confirmedManualPairs: confirmed });
    editingOriginal = null;
    if (nextManual >= 0) this.beginSeamEdit(nextManual);
    else {
      this.setData({ state: "preview" });
      setTimeout(() => this.renderOverview(), 40);
    }
  },

  cancelManual(this: any) {
    editingOriginal = null;
    this.setData({ state: "preview" });
    setTimeout(() => this.renderOverview(), 40);
  },

  returnToSelection(this: any) {
    this.releaseTask(false);
    this.setData({
      state: "select",
      seams: [],
      confirmedManualPairs: [],
      progress: 0,
      currentSeamIndex: 0,
      autoRemovedCount: 0,
      previewPath: "",
      errorMessage: ""
    });
    this.ensureWorker();
  },

  swapCurrentPairAndRetry(this: any) {
    const pairIndex = this.data.currentSeamIndex;
    const images = this.data.images.map((image: SourceImage) => ({ ...image }));
    if (!images[pairIndex] || !images[pairIndex + 1]) return;
    [images[pairIndex], images[pairIndex + 1]] = [images[pairIndex + 1], images[pairIndex]];
    images.forEach((image: SourceImage, order: number) => {
      image.order = order;
    });
    this.releaseTask(false);
    this.setData(
      {
        images,
        seams: [],
        confirmedManualPairs: [],
        currentSeamIndex: 0,
        autoRemovedCount: 0,
        previewPath: "",
        errorMessage: ""
      },
      () => this.startAnalysis()
    );
  },

  previousSeam(this: any) {
    const index = Math.max(0, this.data.currentSeamIndex - 1);
    this.setData({ currentSeamIndex: index });
  },

  nextSeam(this: any) {
    const index = Math.min(this.data.seams.length - 1, this.data.currentSeamIndex + 1);
    this.setData({ currentSeamIndex: index });
  },

  async renderOverview(this: any) {
    if (this.data.state !== "preview") return;
    try {
      const plan = buildStitchPlan(this.data.images, this.data.seams, 1, this.data.stitchDirection);
      const logicalWidth =
        plan.direction === "horizontal"
          ? Math.max(360, Math.min(1200, Math.round((plan.rawWidth / plan.baseHeight) * 228)))
          : 228;
      const logicalHeight =
        plan.direction === "vertical"
          ? Math.max(360, Math.min(1200, Math.round((plan.rawHeight / plan.baseWidth) * logicalWidth)))
          : 228;
      this.setData({ previewCanvasWidth: logicalWidth, previewCanvasHeight: logicalHeight, previewPath: "" });
      await new Promise((resolve) => setTimeout(resolve, 30));
      const canvas = await getCanvasNode(this, "#overviewCanvas");
      const previewScale = Math.min(logicalWidth / plan.outputWidth, logicalHeight / plan.outputHeight);
      const previewPlan: StitchPlan = {
        ...plan,
        scale: plan.scale * previewScale,
        outputWidth: Math.max(1, Math.floor(plan.outputWidth * previewScale)),
        outputHeight: Math.max(1, Math.floor(plan.outputHeight * previewScale))
      };
      const retainedImages = await renderPlanToCanvas(canvas, this.data.images, previewPlan);
      let previewPath = "";
      try {
        previewPath = await canvasToPng(
          canvas,
          previewPlan.outputWidth,
          previewPlan.outputHeight,
          this
        );
      } finally {
        releaseCanvasImages(retainedImages);
      }
      if (this.data.state === "preview") this.setData({ previewPath });
    } catch (error) {
      this.showError(error);
    }
  },

  confirmStitch(this: any) {
    const unresolved = this.data.seams.findIndex(
      (seam: SeamDecision, index: number) => seam.mode === "manual" && !this.data.confirmedManualPairs.includes(index)
    );
    if (unresolved >= 0) {
      this.beginSeamEdit(unresolved);
      return;
    }
    this.exportResult();
  },

  async exportResult(this: any) {
    this.setData({ state: "exporting", progress: 0, progressText: "正在生成长图" });
    try {
      const canvas = await getCanvasNode(this, "#exportCanvas");
      let multiplier = 1;
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const plan = buildStitchPlan(
          this.data.images,
          this.data.seams,
          multiplier,
          this.data.stitchDirection
        );
        if (Math.min(plan.outputWidth, plan.outputHeight) < MIN_OUTPUT_SHORT_EDGE) break;
        this.setData({ progress: 20 + attempt * 20, progressText: `正在生成长图${attempt ? "（自动降低尺寸）" : ""}` });
        try {
          const resultPath = await canvasExport(canvas, plan, this);
          this.setData({
            state: "complete",
            progress: 100,
            resultPath,
            resultWidth: plan.outputWidth,
            resultHeight: plan.outputHeight,
            resultWasScaled: plan.scale < 0.999
          });
          analysisCache = [];
          return;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error("长图导出失败");
          multiplier *= 0.8;
        }
      }
      throw lastError || new Error("图片过长，请减少截图数量后重试");
    } catch (error) {
      this.showError(error);
    }
  },

  saveResult(this: any) {
    if (!this.data.resultPath) return;
    wx.saveImageToPhotosAlbum({
      filePath: this.data.resultPath,
      success: () => wx.showToast({ title: "已保存到相册", icon: "success" }),
      fail: (error: { errMsg?: string }) => {
        if ((error.errMsg || "").includes("auth deny")) {
          wx.showModal({
            title: "需要相册权限",
            content: "请在设置中允许保存图片到相册。",
            confirmText: "打开设置",
            success: (result: { confirm: boolean }) => result.confirm && wx.openSetting()
          });
          return;
        }
        wx.showToast({ title: "保存失败，请重试", icon: "none" });
      }
    });
  },

  restart(this: any) {
    this.releaseTask(false);
    this.setData({
      state: "select",
      images: [],
      seams: [],
      confirmedManualPairs: [],
      progress: 0,
      currentSeamIndex: 0,
      resultPath: "",
      resultWidth: 0,
      resultHeight: 0,
      resultWasScaled: false,
      previewPath: "",
      errorMessage: ""
    });
    this.ensureWorker();
  },

  retryFromError(this: any) {
    this.setData({ state: this.data.images.length >= 2 ? "select" : "select", errorMessage: "" });
  },

  showError(this: any, error: unknown) {
    const message = error instanceof Error ? error.message : "处理失败，请重试";
    if (message === "用户取消分析") return;
    this.setData({ state: "error", errorMessage: message });
  },

  releaseTask(this: any, terminateWorker: boolean) {
    if (activeJobId && analyzerWorker) {
      analyzerWorker.postMessage({ type: "CANCEL", jobId: activeJobId } as WorkerRequest);
    }
    activeJobId = "";
    pendingAnalysis.clear();
    analysisCache = [];
    editingOriginal = null;
    if (terminateWorker && analyzerWorker) {
      analyzerWorker.terminate();
      analyzerWorker = null;
    }
  }
});
