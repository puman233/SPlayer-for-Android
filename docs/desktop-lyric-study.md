# SPlayer 桌面歌词实现研究（供 Android 端移植参考）

来源：克隆 https://github.com/SPlayer-Dev/SPlayer（桌面版）到本地 splayer-orig 研究。

## 关键文件
- src/views/DesktopLyric/index.vue：桌面歌词渲染 UI（核心）。
- electron/main/windows/lyric-window.ts：BrowserWindow 窗口（位置/大小/透明/置顶）。
- src/types/desktop-lyric.d.ts：LyricConfig/LyricData 类型。
- electron/main/ipc/ipc-lyric.ts：IPC（update-data / update-option / request-data / toggle-lock / move / resize 等）。

## 桌面歌词 UI 布局（index.vue）
.desktop-lyric 容器：
- .header（三等分 grid）：
  - 左：Music 图标（show-main）+ 歌名 "playName - artistName"。
  - 中：上一首(playPrev) / 播放暂停(playOrPause) / 下一首(playNext)。
  - 右：设置(Settings) / 锁定(Lock/LockOpen，lock-btn) / 关闭(Close)。
- .lyric-container：歌词行（绝对定位），当前行高亮（playedColor），可逐字(YRC)按进度着色，行间平移/缩放动画 cubic-bezier(0.55,0,0.1,1)。

## 交互设计
- 默认（未 hover）：只显示歌词 & 可选 play-title；.menu-btn/.song-name 为 opacity:0（隐藏）。
- hover（.hovered:not(.locked)）：显示头部控件 + 半透明黑底 rgba(0,0,0,0.6)。
- locked（.locked）：整个窗口 pointer-events:none，仅 .lock-btn 在 hover 时 opacity:1 可解锁。
- 字体大小自适应窗口高度：computedFontSize 20-96 对应窗口高 140-360，线性映射，超窗高自动调字。
- 歌词水平滚动：内容超出容器宽时按剩余进度 translateX 滚动（END_MARGIN_SEC=2 提前）。
- 拖动：pointerdown 拖动窗口，limitBounds 时可限制在多屏边界；lock 时禁拖动。
- 播放进度：playSeekMs 基于 currentTime+offset 用 requestAnimationFrame 插值，300ms 同步阈值防抖；暂停时暂停 RAF 节能。

## 关键逻辑/算法
- calculateLyricIndex(ms, lyrics, 0, 2)：按毫秒计算当前歌词行索引。
- getSafeEndTime：安全结束时间。
- 数据推送：主进程 -> 渲染进程 desktop-lyric:update-data（含 sendTimestamp 补偿 IPC 延迟）。
- 配置：desktop-lyric:update-option / get-option。

## 对 Android 端移植的对应点
Android 原生 FloatingLyricService.java 用 Canvas 自绘（非 Vue）：
- 已实现：5 控制按钮（锁/上一首/播放/下一首/关闭）、无操作 5s 自动隐藏（showCtrls）、锁定 FLAG_NOT_TOUCHABLE+解锁按钮、锁定时仍绘制歌词、pushSongInfo/pushLyrics/pushProgress/applyConfig、默认宽84%/手机30%/平板70%。
- 与原设计差异/待补：
  1. 控制栏未显示"歌名+歌手"（原桌面 header 有），可加。
  2. 平板端未复刻桌面"header 三栏 + 设置按钮"，仍共用 5 按钮（屏幕宽度>=600dp 可区分）。
  3. 图标用 emoji，原设计用 SVG 图标（可选用图标字体/SVG 提升观感）。
  4. 字体自适应的"窗口高->字号"线性映射可参考 computedFontSize（20-96 <-> 140-360）。
