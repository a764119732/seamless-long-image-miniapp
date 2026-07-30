# 青缝长图拼接｜会话交接（2026-07-30）

项目根目录：`E:\obsidian\vibe coding\seamless-long-image-miniapp`

当前分支：`agent/seamless-long-image-miniapp`

## 当前目标

继续维护并推广微信小程序“青缝长图拼接”。`0.1.5` 已于 2026-07-30 审核通过，当前最高优先级是确认正式发布并建立合规、可衡量的跨平台获客路径。

项目仍在持续开发中，不得宣称已经完成。此前确认的线上正式版为 `0.1.3`；用户尚未确认是否已点击“发布”将 `0.1.5` 升为线上版本。

## 产品与技术边界

- 原生微信小程序，TypeScript、WXML、WXSS、Canvas 2D、Worker。
- 支持选择 2–20 张连续截图，自动识别重叠区域、手动微调并生成长图。
- `0.1.5` 新增“左右拼接”，可输出横向宽图；原有“上下拼接”保持不变。
- 原图和结果只在设备本地处理，不上传服务器。
- 无登录、账号、社区、评论、公开内容流或用户内容发布入口。
- 无 `wx.request`、`wx.uploadFile`、`wx.downloadFile`、WebSocket、外部网页或第三方 SDK。
- 固定首页分享卡片只使用预设标题与 `miniprogram/assets/share-card.png`，不读取或分享用户原图、拼接结果。

## 版本与审核经过

### `0.1.3`

- 已审核通过并正式上线，可被普通微信用户使用。
- 目前线上稳定版本。

### `0.1.4`

- 新增固定首页卡片的好友转发与朋友圈分享。
- 不包含用户原图或拼接结果。
- 曾因审核人员无法打开相册、随后将“截图/图片处理”识别为内容安全风险而被拒。
- 相关说明：`docs/审核申诉-0.1.4.md`。

### `0.1.5`

- 新增上下/左右拼接切换与横向宽图输出。
- 审核期间曾被误判为 UGC/图片发布场景并要求内容安全 API，申诉过程保留在下文作为历史证据。
- 用户于 2026-07-30 确认 `0.1.5` 最终审核通过；是否已点击“发布”仍待确认。

官方参考：

- [微信小程序平台运营规范常见拒绝情形 3.2](https://developers.weixin.qq.com/miniprogram/product/reject.html#_3-2-%E5%B0%8F%E7%A8%8B%E5%BA%8F%E9%A1%B5%E9%9D%A2%E5%86%85%E5%AE%B9%E5%AE%A1%E6%A0%B8%E8%A7%84%E8%8C%83)
- [UGC 类小程序运营攻略](https://developers.weixin.qq.com/community/develop/doc/0000e83e8a0b68b3c87962b265c009?highLine=UGC%25E7%25B1%25BB%25E5%25B0%258F%25E7%25A8%258B%25E5%25BA%258F%25E8%25BF%2590%25E8%2590%25A5%25E6%2594%25BB%25E7%2595%25A5)

## 已解决的审核争议（历史记录）

以下是当时提交的误判反馈，`0.1.5` 已审核通过，当前无需重复提交：

> 本小程序为本地图片处理工具，无用户发布、上传、公开展示或供他人浏览图片的场景。用户仅通过wx.chooseMedia选择本机图片，由Canvas在设备端拼接并保存本机；代码无wx.request、wx.uploadFile，原图和结果不传服务器。审核截图是本机待处理列表，并非UGC发布页；固定分享仅为预设首页卡片，不含用户图片。申请按“工具-图片处理”复核。

建议反馈材料使用无隐私的风景测试图，最多上传以下 5 张真实截图：

1. 首页完整截图，显示“图片仅在本机处理”。
2. 选图后的本机待处理列表，显示只有继续选择/拼接，没有发布或上传。
3. 结果页，显示只有预览、保存相册和重新拼接。
4. 微信开发者工具 Network 面板，证明完整流程没有图片上传请求。
5. 隐私说明中关于本地处理、不上传服务器的截图。

长期边界仍然有效：不要为了未来审核盲目引入后端、Access Token 或内容上传流程；任何改变“仅本机处理”承诺的方案均需用户明确决定。

## 当前代码与验证状态

2026-07-30 已重新运行：

```text
npm run check
```

结果：

- TypeScript 类型检查通过。
- 自动测试 25/25 通过。
- 测试覆盖上下/左右画布、横向重叠识别、方向校验、20 张图片、隐私授权、固定分享卡片及无发布流程。

审核说明：`docs/release/0.1.5-审核说明.md`。

## Git 状态

- 分支：`agent/seamless-long-image-miniapp`
- 功能代码提交：`10faed1 feat: add horizontal stitching and campaign kit`
- 交接提交：`7cc4f33 docs: hand off 0.1.5 review state`
- 远端：`https://github.com/a764119732/seamless-long-image-miniapp.git`
- 2026-07-30 已通过 Windows Git Credential Manager 完成一次性持久授权，交接提交及此前积压提交均已推送。后续同一 Windows 账号下的新 Codex 会话可直接使用 `git push`，无需每次重新登录。
- GitHub CLI（`gh`）自身仍保留一枚失效 Token；这不影响 Git 的拉取和推送。如后续需要用 `gh` 管理 Issue、PR 或仓库设置，再单独执行一次 `gh auth login -h github.com`。
- 用户已有未跟踪文件必须保留：
  - `docs/research/wechat-miniapp-growth-2026-07-29.md`
  - `docs/审核申诉-0.1.4.md`

新会话首先执行只读 `git status --short --branch`，不得 `reset --hard`、删除、移动或擅自清理现有改动。

## 已生成的推广材料

- 跨平台文案包：`docs/marketing/跨平台转化素材包-2026-07-29.md`
- 宣传图：`assets/marketing/`
- 场景宣传视频：`assets/marketing/videos/qingfeng-scenario-videos/final/`
- 已制作聊天、网页、学习、清单等版本；用户目前更认可风景照片版，不要把其他版本默认为最终成片。
- 用户已在朋友圈推广并绑定相关公众号，后续增长工作应与审核问题分开处理，避免审核期间继续扩大功能范围。
- 评论推广合规研究：`docs/research/platform-comment-promotion-rules-2026-07-30.md`。

## 下一会话的执行顺序

1. 读取本文件、根目录 `AGENTS.md`、`docs/release/0.1.5-审核说明.md`。
2. 只读检查 Git 状态和当前版本，不重置、不清理。
3. 确认公众平台是否已将审核通过的 `0.1.5` 点击“发布”，不要把“审核通过”误写成“已上线”。
4. 读取评论推广规则研究，优先建设微信生态内的直接承接，并在小红书、抖音、X 使用相关、非重复、非批量的价值评论。
5. 实际改代码后运行 `npm run check`，只提交本任务文件，并按既有 Git 流程尝试推送。

## 新会话可直接粘贴的指令

> 请接管微信小程序项目 `E:\obsidian\vibe coding\seamless-long-image-miniapp`。先完整读取 `docs/SESSION-HANDOFF-2026-07-30.md`、`docs/research/platform-comment-promotion-rules-2026-07-30.md` 和根目录 `AGENTS.md`，再只读检查 Git 状态、当前分支、`package.json` 与 `docs/release/0.1.5-审核说明.md`。保留所有现有改动和未跟踪文件，不重置、不删除、不擅自清理。0.1.5 已审核通过，但是否已点击正式发布待确认；当前优先任务是合规推广和评论获客。请先汇报当前状态、发布确认项和下一步。
