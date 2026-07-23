# 歌词海报设计

## 目标

- 长按具体歌词行 2.5 秒打开全曲歌词选择。
- 支持多选歌词、翻译和音译。
- 支持封面叠加和纯色底图两种海报布局。
- 支持 1080x1440 与 1080x1080 两种输出尺寸。
- 支持自定义颜色、位置、字号、信息和二维码显示。
- 支持保存相册、保存目录、图片分享和图片加文本分享。
- 不接入微信/QQ SDK，使用 Android 系统 Sharesheet。

## 数据流

`PlayerLyric` 行长按 -> `CopyLyrics` 多选 -> `LyricPoster` 配置与预览 -> Canvas PNG -> Android Share 插件或下载/相册。

## 长按规则

- 仅歌词行可触发，不响应歌词空白区域。
- Pointer down 记录行索引，2.5 秒内移动超过 10px、抬起、取消或切歌即取消。
- 成功后预选该行，打开全曲歌词多选。
- 成功长按需阻止本次歌词点击，避免 seek。

## 海报模型

- `mode`: `cover` | `plain`
- `size`: `portrait` | `square`
- `backgroundColor`, `textColor`, `secondaryColor`
- `lyricsTop`, `fontSize`, `lineGap`, `textAlign`
- `showTitle`, `showArtist`, `showAlbum`, `showQr`, `showLink`
- `coverPosition`, `coverSize`

## 原生分享

- 新增 `AndroidShare` Capacitor 插件。
- 图片写入应用 cache/share 后通过 FileProvider 分享。
- 相册保存使用 API 29+ MediaStore，不申请传统存储权限。
- 图文分享尽力附带 `EXTRA_TEXT` 和 `EXTRA_TITLE`，接收应用行为不做保证。

## 权限策略

- 首次初始化集中请求已有功能实际使用的通知权限和悬浮窗权限。
- 拒绝后记录结果，不在启动时重复弹窗。
- 使用悬浮歌词、保存相册或分享时，仅在确实需要且系统允许再次请求时触发功能内提示。
- 海报生成本身不要求额外存储权限。
