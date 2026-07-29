---
workflow: general-video
flow: automation
storyboard: no
mode: autonomous
message: "8张连续截图自动识别重复区域并拼成1张长图，图片仅在本机处理"
audience: "需要整理连续截图的微信用户"
aspect: "1080x1920"
duration: "15s"
---

## Frame 1

status: outline
src: index.html#scene-count
motion: center-outward-expansion + waterfall-entry
time: 0.0–2.0s

八张场景化截图缩略图从左侧聚拢，对应右侧一张连续长图。主文案严格显示“8张截图 → 1张长图”。

## Frame 2

status: outline
src: index.html#scene-overlap
motion: waterfall-entry
time: 2.0–5.0s

三张代表性原图错位叠放，相邻截图中的相同内容用青绿色框和“重复区域”标记，说明八张原图存在重复内容。

## Frame 3

status: outline
src: index.html#scene-process
motion: cursor-click-ripple + center-outward-expansion
time: 5.0–10.0s

模拟小程序操作：点击“从相册选择”，进入相册并依次勾选八张连续截图，随后显示自动识别重叠和拼接完成进度。

## Frame 4

status: outline
src: index.html#scene-scroll
motion: 3d-page-scroll
time: 10.0–13.0s

最终长图在手机视窗内从顶部平稳滚动到底部，内容与前面八张截图对应。

## Frame 5

status: outline
src: index.html#scene-cta
motion: spring-pop-entrance
time: 13.0–15.0s

完整、未裁切、未变形的正式小程序码海报进入画面；同时显示“青缝长图拼接”和“图片仅在本机处理”。
