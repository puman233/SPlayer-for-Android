# 🎵 SPlayer for Android

<p align="center">
  <img src="https://img.shields.io/badge/version-3.0.6-blue?style=flat-square" alt="version">
  <img src="https://img.shields.io/badge/platform-Android%2010%2B-3DDC84?style=flat-square&logo=android&logoColor=white" alt="platform">
  <img src="https://img.shields.io/badge/license-AGPL--3.0-red?style=flat-square" alt="license">
  <img src="https://img.shields.io/badge/Vue-3-4FC08D?style=flat-square&logo=vue.js&logoColor=white" alt="vue">
  <img src="https://img.shields.io/badge/Capacitor-8-119EFF?style=flat-square&logo=capacitor&logoColor=white" alt="capacitor">
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="typescript">
</p>

> **SPlayer for Android 是一款第三方非官方移植版 Android 音乐播放器**，基于 [SPlayer](https://github.com/SPlayer-Dev/SPlayer) 与 [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next) 二次开发，仅用于**个人学习与练习**，与 SPlayer 原项目无任何关联。


---

## ⚠️ 免责声明 (Disclaimer)

- **非官方性质**：本项目是**第三方非官方移植版**，与 [SPlayer](https://github.com/SPlayer-Dev/SPlayer) / [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next) 原项目及其开发者无任何直接关联，亦未获其任何形式的认可或背书。
- **API 使用风险**：本项目可能调用第三方 API（如网易云音乐等）的非官方接口，其稳定性与可用性不受本项目控制，可能随时失效、变更或产生异常，请自行承担相应风险。
- **责任归属**：本项目仅用于**个人学习与练习**。因使用本项目（包括但不限于播放、下载、解锁等操作）而引发的任何直接或间接损失、纠纷或法律责任，均由使用者自行承担，项目作者不承担任何责任。
- **商业使用风险**：请勿将本项目用于商业用途或盈利行为。AGPL-3.0 协议虽允许商业使用，但本项目作者明确声明仅限学习交流，若违反由此产生的法律风险由使用者自行承担。

> 音乐资源版权归各版权方所有，请支持正版音乐；涉及解锁/试听相关的音源接口，请遵守当地法律法规并仅用于个人学习。

---



## ✨ 特性一览

| 分类               | 描述                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------- |
| 🎨 **双端 UI**     | 手机 / 平板自适应布局，沉浸式全屏，状态栏可切换                                       |
| 📐 **手机端布局**  | 全宽贴底底栏 + 圆角浮岛播放栏，底栏选中态滑动指示器；列表 / 卡片 / 设置项轻度紧凑     |
| 🔍 **页面缩放**    | 50%–150% 全局缩放，缩小后等效视口变宽，达到阈值可切换 Pad 布局（尚未完全适配）        |
| 🎵 **播放引擎**    | 原生 ExoPlayer + WebView 双引擎，长时间后台稳定，seek / gapless 切歌进度条同步        |
| 📝 **逐字歌词**    | 毫秒级插值高亮，翻译 / 罗马音，拖动吸附最近行，支持全局歌词偏移                       |
| 📂 **本地音乐**    | 自动扫描本地歌曲，支持 TTML / LRC 歌词匹配（同目录 / 独立歌词目录），与桌面端行为对齐 |
| ☁️ **WebDAV 音乐** | 通过 WebDAV 连接远程音乐，在线播放与浏览，扩展私人曲库                                |
| 🪟 **桌面歌词**    | `WindowManager` 悬浮窗，逐字动画、锁定穿透、拖拽、播控                                |
| 🔔 **通知栏**      | 原生 `MediaSession`，完整播控，支持桌面歌词一键开关                                   |
| 🎚️ **精细控制**    | 渐入渐出、进度吸附歌词、允许与其他应用同时播放                                        |
| 🌐 **在线音乐**    | 网易云 + Jellyfin / Navidrome / Emby / Subsonic / OpenSubsonic / Last.fm              |
| 🔗 **网络代理**    | 支持配置 HTTP/HTTPS 代理，内置逆向 API 请求可走代理访问网易云接口                     |
| ⬇️ **音乐下载**    | 开发者模式下可下载歌曲至 SAF 授权目录，支持自定义子目录分类、歌词/ASS 附件下载        |
| 🧩 **内置 API**    | `nodejs-mobile-cordova` 嵌入网易云 API，离线可用                                      |
| 📦 **分架构打包**  | `arm64-v8a` / `armeabi-v7a` / `x86_64` / `x86` 独立 APK                               |

---

## 📱 平台兼容性

**最低要求：Android 10（API 29）**

> ⚠️ 更早的 Android 版本（Android 9 及以下）没有计划去实现支持。原因是：
>
> - 旧版 Android 性能不足以流畅运行本应用的 WebView 渲染和音频处理
> - Android 10 以下可用的系统 API 较少，无法实现 SAF 文件访问、MediaStyle 通知、深色模式适配等核心功能
> - 这些版本的设备硬件早已过时，完全不适合运行本应用

---

## 📦 下载与安装

前往 [**Releases**](../../releases) 选择对应 CPU 架构的 APK：

|       ABI       | 适用设备                       |   推荐度   |
| :-------------: | ------------------------------ | :--------: |
| **`arm64-v8a`** | 绝大多数现代手机 / 平板        | ⭐⭐⭐⭐⭐ |
|  `armeabi-v7a`  | 2015 年前的老旧 32 位 ARM 设备 |    ⭐⭐    |
|    `x86_64`     | Intel 平板、Android 模拟器     |     ⭐     |
|      `x86`      | 极少数 32 位 Intel 设备        |     ⭐     |

> 💡 不清楚自己设备架构？装个 **CPU-Z**，或者无脑选 `arm64-v8a`——99% 都是它。

---

## 🆕 更新日志

> 完整更新记录请查看 [**CHANGELOG.md**](./CHANGELOG.md)

---

## 🚀 快速开始

### 环境要求

| 工具              | 版本    |
| ----------------- | ------- |
| Node.js           | `>= 20` |
| pnpm              | `>= 10` |
| JDK               | `21`    |
| Android SDK / NDK | 最新    |

### 一键构建

```bash
pnpm install
pnpm build:android
cd android && ./gradlew assembleDebug
```

产物：`android/app/build/outputs/apk/debug/`（按 ABI 分包）

### 分步构建

```bash
pnpm build:web                  # 前端 Vite 构建
pnpm build:android:node         # 内置 Node API Bundle
pnpm prepare:android:embedded   # 准备嵌入资源
npx cap sync android            # 同步 Capacitor 工程
npx cap open android            # Android Studio 打开
```

---

## ❓ FAQ

<details>
<summary><b>🔑 桌面歌词（悬浮歌词）怎么用？</b></summary>

<br>

> 在 **设置 → 歌词 → 桌面歌词** 打开。首次开启会弹出悬浮窗权限申请（跳转系统设置授权），授权后歌词即可显示在其他应用上层。若拒绝授权，该功能将不可用。

</details>

<details>
<summary><b>🎧 想和其他应用同时播放？</b></summary>

<br>

进入 **设置 → 播放 → Android 系统设置 → 允许与其他应用同时播放**。

> ⚠️ 注意：开启后将切换为 ExoPlayer 引擎（handleAudioFocus=false），不再抢占音频焦点，可与其他应用同时播放。

</details>

<details>
<summary><b>📦 我该下载哪个 APK？</b></summary>

<br>

无脑选 **`arm64-v8a`**。只有极老的设备（通常 2015 年前）才需要 `armeabi-v7a`。`x86` / `x86_64` 几乎只用于模拟器。

</details>

<details>
<summary><b>🖥️ 能在电脑上运行吗？</b></summary>

<br>

本仓库已剥离 Electron 桌面端打包链路，**仅保留 Android 构建**。需要桌面版请前往 [原版 SPlayer](https://github.com/imsyy/SPlayer)。

</details>

<details>
<summary><b>🔕 通知栏控制器不显示？</b></summary>

<br>

1. **设置 → 播放** 里打开 **"通知栏音乐控制器"**
2. 系统设置里允许 SPlayer 发送通知（Android 13+ 首次启用会弹权限框）

</details>

<details>
<summary><b>🌙 支持后台播放吗？</b></summary>

<br>

支持。通知栏控制器启用后，应用进入后台仍会继续播放，不会被系统快速回收。

</details>

<details>
<summary><b>📂 本地歌词不显示？</b></summary>

<br>

1. 进入 **设置 → 本地与缓存 → 本地歌词覆盖在线歌词**，添加歌词所在目录
2. 歌词文件可按 `歌曲ID.ttml` / `歌曲ID.lrc` 或 `歌名.歌曲ID.ttml` / `歌名.歌曲ID.lrc` 命名
3. TTML 文件内含 `ncmMusicId` 元数据的也可自动匹配
4. 放在音乐同目录下、与音频同名的歌词文件（如 `歌曲名.lrc`）也会自动识别

</details>

<details>
<summary><b>⬇️ 如何下载歌曲？</b></summary>

<br>

1. 进入 **设置 → 常规**，连续点击版本号 5 次开启开发者模式
2. 在 **设置 → 本地与缓存 → 下载配置** 中选择下载目录（SAF 授权）
3. 在歌曲列表中点击菜单即可看到下载选项

</details>

---

## 🤖 CI / 发布

手动触发 [`Android Release`](./.github/workflows/android-release.yml) 工作流即可分架构构建 & 发布 APK。

签名所需 Secrets：

| Secret                      | 说明                    |
| --------------------------- | ----------------------- |
| `ANDROID_KEYSTORE_BASE64`   | Keystore 的 Base64 编码 |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore 密码           |
| `ANDROID_KEY_ALIAS`         | Key 别名                |
| `ANDROID_KEY_PASSWORD`      | Key 密码                |

详细说明见 [`.github/ANDROID_RELEASE_SECRETS.md`](./.github/ANDROID_RELEASE_SECRETS.md)。

---

## 🧑‍💻 参与贡献

欢迎提 Issue 与 PR！提交前请先阅读 [**CONTRIBUTING.md**](./CONTRIBUTING.md)，了解 Issue / PR / Commit 规范。

- 🐞 [提交 Bug](../../issues/new?template=bug.yml)
- ✨ [提交功能建议](../../issues/new?template=feature.yml)
- 📮 [发起 Pull Request](../../compare)

### 👥 贡献者

感谢每一位为本项目付出时间与代码的伙伴 ❤️

<a href="https://github.com/SPlayer-Dev/SPlayer-for-Android/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=SPlayer-Dev/SPlayer-for-Android" alt="contributors">
</a>

> 图片由 [contrib.rocks](https://contrib.rocks) 自动生成，随 GitHub 贡献图谱更新。

---

## 🤝 致谢

本项目基于 [**SPlayer**](https://github.com/imsyy/SPlayer) 移植，向原作者 [@imsyy](https://github.com/imsyy) 与所有贡献者致以最诚挚的感谢 ❤️

---

## 📄 许可证

本项目基于 [**AGPL-3.0**](./LICENSE)（GNU Affero General Public License v3.0）开源协议发布，与上游保持一致。

- **原项目版权**：原 [SPlayer](https://github.com/SPlayer-Dev/SPlayer) / [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next) 版权归原开发者团队所有，本版本保留其原始版权声明。
- **修改说明**：本版本为 Android 平台移植版，已对前端与原生层进行适配和优化，属 AGPL-3.0 协议下的衍生作品。

**AGPL-3.0 核心要求**：
- 🔓 **开源**：任何修改、衍生或分发本项目的作品，必须同样以 AGPL-3.0 协议开源，并完整提供对应的源代码。
- ©️ **保留版权**：不得移除或修改原始版权声明与许可信息。
- 📦 **提供源码**：向使用者分发本项目或其修改版本时，须同时提供可获取的源代码，或提供指向源代码的明确链接。

完整条款请参阅 [LICENSE](./LICENSE) 文件或 [GNU AGPL-3.0 官方文本](https://www.gnu.org/licenses/agpl-3.0.html)。
