# 桌面歌词控件重构开发方案（SPlayer-for-Android）

## 一、背景与目标

对 SPlayer for Android 的桌面歌词悬浮控件（`FloatingLyricService.java`）进行全面重构，
复刻桌面端 SPlayer 的桌面歌词设计（参考图1），并按设备类型（手机/平板）差异化适配。
本版本为「上个版本的修复版本」，需在不破坏原有功能的前提下完成。

## 二、现状分析（已完成的代码研究）

### 2.1 桌面歌词实现架构
- **原生层**：`FloatingLyricService.java`（约 886 行），使用 WindowManager + 自定义 Canvas View 绘制，非 Vue。
- **数据链路**：
  `Vue(PlayerController)` → `AndroidNativePlaybackPlugin` → `PlaybackManager`（带缓冲回放）→ `FloatingLyricService`。
  - 歌词：`pushLyrics(lrcJson, yrcJson)`
  - 进度：`pushProgress(ms, playing)`（内部按 nanoTime 插值）
  - 歌曲信息：`pushSongInfo(name, artist)`
  - 配置：`applyConfig(JSONObject)`（持久化到 prefs）
- **现有能力**：
  - 5 个控制按钮（锁/上一首/播放/下一首/关闭），emoji 图标。
  - 无操作 5s 自动隐藏控制栏（showCtrls）。
  - 锁定 → 主窗 FLAG_NOT_TOUCHABLE 穿透 + 独立解锁小按钮窗。
  - 平板（最小屏宽 >=600dp）默认在屏幕 70% 处，手机在 30% 处。
  - 宽度默认 92%（原生），前端 `lyricConfig.ts` 默认 84%（左右各 8%）。
  - YRC 逐字渐变渲染（paintWordLyric）、双行（翻译/下一行）、行切换动画、文字自适应缩放（最长缩到 55%）。

### 2.2 图1 的桌面歌词控件结构（需复刻）
顶部 header 三栏 grid：
- 左：音符图标 + 歌名 "playName - artistName"
- 中：上一首 / 播放暂停 / 下一首
- 右：设置(齿轮) / 锁定 / 关闭
下方居中歌词行（当前行高亮，可逐字着色）。默认只显示歌词；hover 显示头部。

### 2.3 前端设备判断
- `useDevice.ts`：`isPad`（平板硬件 + 横屏）→ pad UI；`isPhone` 其余。
- `useMobile.ts`：Tailwind 断点（isMobile = <640px）。

### 2.4 图2-图5 问题定位
- **图2（重叠）**：手机播放页 `FullPlayerMobile.vue` 的 `.info-actions` 行（心/加歌/歌单/More）
  中 `PlayerQuickActionsMenu` 的 More 圆钮存在重叠/遮挡。
- **图3/图4（菜单文字阴影）**：`main.scss` 474-483 全局给
  `.n-dropdown-option` / `.n-popover__content` 加了 `text-shadow`，导致下拉/弹层文字发虚。
  - 图3 = `Layout/Nav.vue`（设置下拉），图4 = `Layout/User.vue`（账号下拉）。
- **图5（菜单下阴影）**：快捷操作弹层（`PlayerQuickActionsMenu`）的**面板 box-shadow 需保留**
  （这是弹层自身的投影，与 text-shadow 无关，删除 text-shadow 不影响它）。

## 三、需求拆解

### 3.1 设备差异化适配
| 设备 | 控件按钮 | 默认位置 | 宽度 | 说明 |
|------|---------|---------|------|------|
| 手机 | 播放/暂停、上一首、下一首、锁定、关闭（5 钮） | 屏幕 30% | 左右各 8%（84%） | 简单紧凑，不超过屏幕 |
| 平板 | 复刻桌面：header 三栏（歌名区 + 播放三键 + 设置/锁定/关闭） | 屏幕 70% | 动态智能调整 | 完整桌面 UI |

### 3.2 交互逻辑
- 未触碰：只显示歌词，自动隐藏头部/控制钮。
- 触碰/悬停：显示控制钮与歌名 header（平板）或 5 钮（手机），几秒后自动隐藏。
- 锁定：显示锁定图标；位置固定、禁止拖动与关闭；解锁按钮独立可点。

### 3.3 位置与尺寸
- 平板默认垂直 70% 处；手机默认 30% 处（现状已满足）。
- 手机竖屏左右各距屏幕边缘 8%（宽度 84%）：需要前端把 windowWidthPercent 推给原生，或原生默认 84%。
- 控件不得超出屏幕边缘：拖动时按屏幕边界 clamp（恢复 `limitBounds` 语义）。
- 歌词字号自适应：按窗口高度/屏幕尺寸线性映射（参考桌面 computedFontSize 20-96 ↔ 窗口高 140-360），避免固定字号溢窗。

### 3.4 快捷开关 / AMLL
- 支持：音频频谱、动态封面、桌面歌词开关、逐词效果、在线 TTML 歌词、音量、歌词字号（A+）。
- 保留 AMLL 逐词渲染（YRC 渐变），确保逐字高亮动画正常。

## 四、实现方案

### 4.1 重构 `FloatingLyricService.java`
1. **设备判定**：增加 `isTablet` 判定（复用 `smallestScreenWidthDp >= 600`，已存在），
   区分绘制两种布局。
2. **平板 header 三栏**：
   - 左：音符图标 + 歌名/歌手（`pushSongInfo` 数据）。
   - 中：上一首/播放暂停/下一首。
   - 右：设置(齿轮) / 锁定 / 关闭。
3. **手机 5 钮**：保留现有 5 钮布局（锁/上一首/播放/下一首/关闭），顶部歌名保留。
4. **图标**：把 emoji 换成图标字体（复用 `iconfont_notification.ttf` 或新增 Glyph），提升观感。
5. **字号自适应**：实现「窗口高 → 字号」线性映射 + 屏幕尺寸系数，兼顾手机/平板。
6. **边界 clamp**：拖动（`updateViewLayout` 前）按屏幕当前可用区 clamp X/Y，避免越界/跑出屏幕。
7. **设置按钮（平板）**：
   - 方案：在悬浮窗内弹出**原生 Canvas 绘制的快捷开关抽屉**，复刻图5 的快捷开关项
     （音频频谱/动态封面/桌面歌词/逐词效果/在线 TTML歌词/音量/歌词字号）。
   - 开关状态读写：通过 `PlaybackManager` → `AndroidNativePlaybackPlugin` → 事件/方法同步到 JS，
     与前端 `PlayerQuickActionsMenu` 共用同一套 settingStore 状态。
   - 该抽屉也支持「锁定/关闭/返回」。
8. **锁定态**：平板在 header 右侧显示锁定图标（`.lock-btn`），主窗穿透 + 独立解锁钮；手机沿用现状。

### 4.2 前端改动（配置/同步）
- `src/components/Setting/config/lyric.ts`：确保把 `windowWidthPercent`（手机 84）/ `windowHeightDp`
  随配置推送到原生；`syncFloatingLyricConfig` 补传缺失字段。
- 视需要新增「设备差异化」配置项或仅在原生按设备取默认。

### 4.3 图2-图5 修复
- **图2**：调整 `FullPlayerMobile.vue` 的 `.info-actions` 布局与 `PlayerQuickActionsMenu`
  手机触发钮尺寸/边距，消除 More 按钮与其他图标的重叠；连带 `PlayerData`/标签行布局微调。
- **图3/图4**：移除 `main.scss` 474-483 全局 `text-shadow`（或仅对 dropdown 移除），
  保持菜单文字清晰无阴影。
- **图5**：确认快捷操作弹层保留面板 box-shadow（删除 text-shadow 不影响其投影），必要时补一条
  只针对 quick-actions 弹层的 box-shadow 样式以确保投影保留。

## 五、调试与验证
- 用 adb 连接当前可用模拟器 `emulator-5556`（Pixel Tablet，Android 15），以及 `Medium_Phone` AVD
  验证手机端；鼓励接入真机。
- 按验证清单逐项勾选（手机 5 钮 / 平板全 UI / 未触碰仅歌词 / 锁定图标 / 平板 70% 手机 30% /
  手机 84% 宽 / 不越界 / 字号自适应 / 图2 修复 / 图3图4 无阴影 / 图5 阴影 / AMLL 逐词正常）。

## 六、发布
- 跑 `pnpm lint` / `pnpm typecheck` / `pnpm build:android`，0 错误 0 警告。
- 使用 `my-release-key.jks` 签名，打包 4 大架构 release APK（arm64-v8a / armeabi-v7a / x86_64 / x86）。
- Git 推送到 `origin`（puman233/SPlayer-for-Android），维护 CHANGELOG，由用户发布 GitHub Releases。

## 七、待确认事项
1. 平板端「设置」按钮：采用**原生 Canvas 快捷开关抽屉**是否可接受？（浮动窗与主 App 分离，无法直接弹出 Vue 弹层）
2. 当前只有平板模拟器在线；手机端验证将用 `Medium_Phone` AVD（非真机），是否接受？
3. 是否本次一并完成 release 签名打包与 GitHub 推送，还是先完成代码 + 验证后由你决定发布？

---

## 八、实施进度（已按确认决策 1B / 2A / 3A 推进）

### 已完成
- **图3/图4**：移除 `src/style/main.scss` 全局菜单 `text-shadow`（改为 `none`），图5 弹层面板 box-shadow 不受影响。
- **图2**：`FullPlayerMobile.vue` 的 `.info-actions` 增加 `flex-wrap: nowrap` + 歌单徽标右侧间距，避免 More 按钮与 304 徽标重叠（防御性修复，待真机确认）。
- **FloatingLyricService 重构**：
  - 设备区分（`smallestScreenWidthDp >= 600` → `tabletMode`）。
  - 平板复刻桌面 header 三栏（♪+歌名｜上一首/播放/下一首｜设置/锁定/关闭）。
  - 手机保留 5 钮（锁/上一首/播放/下一首/关闭）+ 顶部歌名。
  - 默认位置：平板 70% / 手机 30%；手机宽度 84%（左右各 8%）。
  - 拖动与初始位置按屏幕边界 `clampCoord` 钳制，控件不越出屏幕。
  - 字号自适应 `computeAdaptiveFontSize`（按区域高度/屏幕尺寸智能调整）。
  - 设置按钮（1B）：`emitDesktopLyricOpenSettings` → 事件 → JS 打开快捷面板。
  - 保留 AMLL 逐字渐变渲染、锁定穿透+独立解锁钮、双行、行切换动画。
- **前端**：`PlayerController.syncFloatingLyricConfig` 补推 windowWidthPercent/windowHeightDp；
  `androidNativePlayback.ts` 动作类型加 `desktopLyricOpenSettings`；`statusStore.desktopLyricOpenQuickActions` 瞬时标记 +
  `MediaSessionManager` 处理器 + `PlayerQuickActionsMenu` 监听弹层。
- **环境修复**：NDK 目录异常（ndk 空、ndk.original 有实际 NDK），已建 junction 使 Gradle 解析成功。

### 验证状态
- `pnpm typecheck:web`（0 错）、`pnpm lint`（0 错 0 警）、`pnpm build:web`、`gradle assembleDebug` 全部通过。
- **平板端 header 布局已在 Pixel Tablet 模拟器上目视确认**（♪ SPlayer｜⏮▶⏭｜⚙🔓✕，位于 70% 高度）。
- **手机端浮动歌词 / 图2 精确还原**受限于当前 Windows 宿主（无 macOS Vision OCR、应用不可 debuggable、Android 17 弹 16KB 对齐对话框、悬浮服务非 exported），未能在本会话内完整目视确认；图2 为防御性修复，需在真机上复核。

### 决策 3A：发布打包 + GitHub 推送待你确认后执行。
