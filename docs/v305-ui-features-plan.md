# v3.0.5 UI 修复与功能增强计划

> 目标：在 VIP 播放稳定的基础上，修复 UI 布局 Bug、增强自适应能力，移植热重载/通知栏控制/桌面歌词/心动模式。

## 一、UI 修复与自适应

### 1.1 右下角浮层按钮遮挡播放栏
- **根因**：`SongList.vue` `.list-menu`（回到顶部/定位按钮）`position: fixed; bottom: 120px; z-index: 10`，Teleport 到 body 后 DOM 顺序晚于播放栏，与手机浮岛播放栏（`MainPlayer.vue` `.phone-floating`，底部 = nav + safe-bottom + gap）重叠。
- **方案**：
  1. `.main-player` 的 `z-index` 提升为 `20`（播放栏永远在最上层）。
  2. `.list-menu` 的 `bottom` 改为 `calc(var(--phone-nav-total-height) + var(--phone-player-height) + var(--phone-player-gap) + 16px)`，并在桌面/Pad 保持原 120px。
  3. 滚动时按钮自动隐藏（现有 `hidden` 逻辑已存在，保持）。

### 1.2 歌手/歌单详情页文字错位
- 审查 `src/views/Artist/layout.vue` 与 `src/components/List/ListDetail.vue` 的固定 px 宽高，改用 flex/grid + 相对单位。

### 1.3 全局页面自适应
- 审查 `src/views/*` 与 `src/components/*` 中硬编码宽高，统一相对单位与 CSS 变量。

## 二、功能移植

### 2.1 热重载
- 设置「常规设置 → 其他设置」新增「热重载」按钮，点击后 `window.location.reload()`。

### 2.2 通知栏音乐控制
- 后端能力已存在（`PlaybackManager` MediaStyle 通知 + MediaSession）。
- 恢复 `POST_NOTIFICATIONS` 权限声明（Manifest）。
- 恢复 `AndroidNativePlaybackPlugin.requestNotificationPermission`（Android 13+ 运行时请求）。
- 前端：`handleAndroidMediaControllerChange` 启用时先弹 App 自定义样式确认框 → 授权通过才开启；拒绝则提示不可用。

### 2.3 桌面歌词（悬浮歌词）
- 后端能力已存在（`FloatingLyricService` + `showFloatingLyric/hideFloatingLyric`）。
- 恢复 `SYSTEM_ALERT_WINDOW` 权限声明（Manifest）。
- 恢复 `AndroidNativePlaybackPlugin.requestOverlayPermission`（跳系统设置页）。
- 前端：`setDesktopLyricShow` Android 分支恢复权限检查 → 无权限弹 App 自定义确认框 → 跳系统设置授权 → 成功后 `showFloatingLyric()`。

### 2.4 心动模式按钮
- 心动模式逻辑已存在：`player.toggleShuffle("heartbeat")`，图标 `HeartBit`。
- 在「我喜欢的音乐」页 `ListDetail` 播放按钮旁新增红心按钮（`action-buttons` 插槽）。

## 三、真机验证
- 构建 APK → adb 安装 → CDP 验证 UI 遮挡/错位 → logcat 捕获错误 → 最多 5 轮迭代。

## 四、交付
- lint / typecheck 0 错 0 警告。
- 版本号 3.0.5，CHANGELOG 记录，README/关于页声明更新。
- Git 提交 + tag v3.0.5。
