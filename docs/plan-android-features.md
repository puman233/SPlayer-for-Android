# SPlayer-for-Android 功能完善规划

> 本文档梳理项目现状与五阶段实施计划，作为开发与评审依据。

## 一、项目现状

- 技术栈：Vue 3 + TypeScript + Naive UI + Capacitor（Android 端，嵌入本地 Node API）。
- 当前分支：`dev`，版本 `v3.0.6`。
- 相关核心文件：
  - 设置菜单（右上角齿轮下拉）：`src/components/Layout/Nav.vue`
  - 底部导航栏：`src/layout/AppLayout.vue`
  - 全局设置页面：`src/components/Setting/MainSetting.vue`（以 `utils/modal.ts` 的 `openSetting()` 卡片弹窗打开）
  - 关于软件/问题反馈：`src/components/Setting/AboutSetting.vue`
  - 移动端全屏播放器：`src/components/Player/FullPlayerMobile.vue`
  - 歌词渲染：`src/components/Player/PlayerLyric/index.vue`（AMLyric / DefaultLyric）
  - 全屏控制栏：`src/components/Player/PlayerControl.vue`
  - 环境判断：`src/utils/env.ts`（`isElectron` / `isCapacitorAndroid`）
  - 更新日志：`src/utils/helper.ts#getUpdateLog`

## 二、分阶段实施

### 1. 软件热重载按钮（Nav.vue）
- 现状：`软件热重载` 菜单项 `show: isElectron`，仅 Electron 显示，Android 不显示。
- 改动：让其在 Android（Capacitor）也显示；Electron 走 `win-reload` IPC，Android 走 `window.location.reload()`（重载 WebView，不重启 App）。
- 目标：图3 展示的菜单效果。

### 2. 底部导航长按刷新（AppLayout.vue + 各 Tab 视图）
- 底栏四个 Tab（推荐/发现/收藏/最近）长按 2 秒触发当前界面刷新。
- 触发统一的页面刷新信号，由当前路由对应的视图监听并重新拉取数据。
- 图标按下缩放 0.92 → 弹起 1.0，`cubic-bezier(0.34,1.56,0.64,1)` 300ms。
- 不干扰短按切换 Tab。

### 3. 全局设置全屏化（MainSetting.vue / modal.ts）
- 现状：`openSetting()` 以卡片弹窗打开，`MainSetting` 高度 75vh，移动端左菜单抽屉式。
- 目标：点击全局设置后整页全屏展示，左侧分类导航 + 右侧具体设置项（保留原有全部设置项）。
- 实现：弹窗样式改为全屏（`width/height 100%`，去圆角/阴影），`MainSetting` 布局高度跟随全屏。

### 4. 关于软件与反馈信息修改（AboutSetting.vue / helper.ts）
- 检查更新与最新/历史版本：改为读取 `puman233/SPlayer-for-Android` 的 GitHub Release。
- 问题反馈：跳转 `https://github.com/puman233/SPlayer-for-Android/issues`，并在描述中预填设备信息。
- 删除：加入 QQ 交流群按钮/字符串、社区与资讯区块（含原项目贡献者信息）。
- 保留：版本号展示、检查更新按钮等基本结构。

### 5. 歌词页播放控制模块（FullPlayerMobile.vue）
- 在歌词页底部复现播放页控制模块（上一曲/播放暂停/下一曲、随机、循环、进度条）。
- 无操作 3 秒渐隐（透明度 1→0，1s），触摸屏幕重新渐显。
- 控制模块显示时，被遮挡的歌词区域隐藏（滚动区域上移/裁剪）。
- 歌词高亮当前行默认位于屏幕垂直 45% 处，平滑跟随播放进度。

## 三、验证
- 每完成一项立即在真机验证（dsh-android / ADB）。
- 完成后回归：播放、搜索、歌单等原有功能不受影响。
- 提交前运行 `pnpm lint`、`pnpm typecheck`、`pnpm format`，确保 0 错误 0 警告。
- 功能分支提交并推送，更新 CHANGELOG.md 与 README。
