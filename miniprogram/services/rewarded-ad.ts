import { GRID_REWARDED_AD_UNIT_ID } from "../config/monetization";

type AdResult = "completed" | "cancelled" | "unavailable";
let cancelPending: (() => void) | null = null;

export function cancelRewardedAd(): void {
  cancelPending?.();
}

export function watchGridRewardedAd(): Promise<AdResult> {
  if (cancelPending) return Promise.resolve("cancelled");
  if (!GRID_REWARDED_AD_UNIT_ID || typeof wx.createRewardedVideoAd !== "function") {
    return Promise.resolve("unavailable");
  }
  return new Promise((resolve) => {
    let ad: RewardedVideoAdLike;
    try {
      ad = wx.createRewardedVideoAd({ adUnitId: GRID_REWARDED_AD_UNIT_ID, multiton: true });
    } catch {
      resolve("unavailable");
      return;
    }
    let settled = false;
    const finish = (result: AdResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(loadTimeout);
      cancelPending = null;
      ad.offClose(onClose);
      ad.offError(onError);
      ad.destroy();
      resolve(result);
    };
    const onClose = (result?: { isEnded?: boolean }) => finish(result?.isEnded === true ? "completed" : "cancelled");
    const onError = () => finish("unavailable");
    const loadTimeout = setTimeout(onError, 15000);
    cancelPending = () => finish("cancelled");
    ad.onClose(onClose);
    ad.onError(onError);
    Promise.resolve().then(() => { if (!settled) return ad.load(); }).then(() => {
      clearTimeout(loadTimeout);
      if (!settled) return ad.show();
    }).catch(onError);
  });
}
