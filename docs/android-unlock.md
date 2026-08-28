# SPlayer-for-Android 音乐解锁功能交付说明

> 目标：让 Android 版与原版 SPlayer 一致的开箱即用解锁体验——**默认启用、自动降级、无感解锁**。

## 〇、本次综合诊断与优化（2026-08-28）

### 新增改动
| 文件 | 改动 |
| --- | --- |
| `scripts/build-android-node.ts` | esbuild 开启 `minify: true`，嵌入式服务器 `main.js` **615KB → 289KB**（APK 约减 0.1MB），实测 kuwo/bodian 解锁功能正常 |
| `src/utils/embeddedApi.ts` | 嵌入式 API 启动失败提示增强（"将自动重试"+8s），避免误导用户 |

### 嵌入式 API 启动链路（已核查，均正常）
- `window.nodejs` 由 `nodejs-mobile-cordova` 插件注入（`plugin.xml` clobbers `nodejs`），`deviceready` 后可用；
- `src/main.ts` → `waitForEmbeddedApiReady()` → `window.nodejs.start("main.js")`（相对 `assets/www/nodejs-project`）→ 服务器监听 `127.0.0.1:1145`；
- 错误捕获：nodejs-mobile **无 `onError` API**，但 `start` 回调错误参数 + `redirectOutputToLogcat:true` 已覆盖，错误会进 logcat；
- 独立启动实测：`/api/netease`（vendor 正常）、`/api/netease/song/url/v1`（官方 404→触发解锁）、`/api/netease/unblock/bodian`（返回真实 mp3）全部通过。

### 未改动项及原因
- **音源健康检查**：未实现"启动时自动禁用失效源"。因 `getUnlockSongUrl` 已实现**并发请求所有源、按序取第一个成功**（播放时即自动跳过失效源），且外部源临时不可用会误禁用用户配置，故不持久化修改。
- **minSdk 降级（29→24）**：未降级。minSdk 29 是项目基线（Capacitor 8 + nodejs-mobile 兼容范围），降级风险高且非解锁核心需求。
- **ProGuard / 移除依赖**：debug 构建默认不启用，不主动改动。

## 一、修改的文件清单

| 文件 | 改动 |
| --- | --- |
| `src/stores/setting.ts` | 默认音源顺序改为 `NETEASE → KUWO → BODIAN → GEQUBAO` 且全部启用（`useSongUnlock` 本就默认 `true`） |
| `src/stores/migrations/settingMigrations.ts` | v4 迁移的默认音源顺序同步为新顺序 |
| `src/core/player/SongManager.ts` | ① `getOnlineUrl` 始终返回 url（试听也返回），缓存/下载仅用非试听 url；② `getAudioSource` 解锁失败静默回退官方试听；③ 本地文件检查 `window.electron` 加 `isElectron` 保护；④ `prefetchNextSong` 未启用解锁时不再预载试听 |
| `src/components/Setting/config/play.ts` | 解锁设置项对 Android 可见（`show: isElectron \|\| isCapacitorAndroid`） |
| `API/mobile-server.ts` | 新增 `/api/netease/unblock/{server}` 路由 |
| `API/unblock/`（新增） | 解锁服务器：`index.ts` / `kuwo.ts` / `bodian.ts` / `gequbao.ts` / `match.ts` / `types.ts` / `kwDES.js` |
| `tsconfig.node.json` | 补 `skipLibCheck: true`（与 web 一致，修复环境既有 `.d.ts` 类型错误） |

## 二、逻辑变化说明

### 1. 默认启用（无感）
- `useSongUnlock` 默认 `true`，首次启动即自动开启解锁，用户无需手动操作。
- 默认音源顺序 `netease → kuwo → bodian → gequbao`，全部启用；播放时按顺序自动尝试，某源失效自动切换下一源。

### 2. 自动降级与无缝切换（`SongManager.ts`）
- **`getAudioSource()`** 播放链路：
  1. 先请求官方（网易云）链接；
  2. 官方返回**非试听** → 直接用官方（不解锁）；
  3. 官方**试听 / 403 / 404** → 自动并发尝试解锁音源（`canUnlock` 已包含 `isCapacitorAndroid`）；
  4. 解锁成功 → 用解锁链接；
  5. 解锁失败 → **静默回退官方音源（即使只有试听片段）**，不再直接报"无法播放"；
  6. 兜底本地缓存。
- **`getOnlineUrl()`** 现在始终返回播放 url（含试听），但**试听片段不写入本地缓存/不触发下载**，避免污染缓存。
- 解锁请求为 async/await，不阻塞 UI 线程；所有失败路径均有 try/catch 静默降级，无错误弹窗。

### 3. 移除平台限制
- 全局已无 `isElectron` 解锁限制（`canUnlock`、设置项 `show` 均已放开）。
- 本地文件检查的 `window.electron.ipcRenderer` 调用已加 `isElectron` 保护，Android 端不会因 `window.electron` 未定义而报错。
- `DownloadManager` 中"下载时使用解锁接口"（`useUnlockForDownload`）走同一 `/api/netease/unblock` 路由，服务器路由放开后自动生效。

## 三、构建 APK

### 1. 安装依赖
```bash
pnpm install
```

### 2. 构建 Web + 同步 Capacitor + 打包嵌入式 Node 服务器
```bash
pnpm build:android
```
> 该命令依次执行：`pnpm build:web`（构建前端）→ `npx cap sync android`（同步原生工程）→ `pnpm build:android:node`（打包嵌入式 API 服务器）→ `pnpm prepare:android:embedded`（准备 node 运行时资源）。

### 3. 编译 APK（Gradle）
```bash
cd android
./gradlew assembleDebug
```
> Windows 下用 `gradlew.bat assembleDebug`。产物位于 `android/app/build/outputs/apk/debug/app-debug.apk`。

> 若需发行签名包：`./gradlew assembleRelease`（需先在 `android/app` 配置签名）。

### 4. 安装到真机
```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```
或直接将 APK 传到手机点击安装（需允许"安装未知来源应用"）。

## 四、真机测试建议

1. 打开 App → 设置 → 播放 → 确认"音乐解锁"开关已开启（默认即开）。
2. 播放几首 **VIP / 无版权（变灰）** 歌曲：
   - 应自动解锁并流畅播放（播放页显示"解锁"标识）；
   - 若某音源失效，应自动尝试下一音源，无明显卡顿或报错；
   - 若全部解锁失败，应回退播放官方试听片段而非报错。
3. 切歌、后台播放、锁屏播放验证队列续播正常。

## 五、可选：完全隐藏设置开关（达到"完全无感"）

原版 SPlayer 实际保留"音乐解锁"开关（本交付也保留，便于回退）。若希望完全隐藏：

编辑 `src/components/Setting/config/play.ts`，"音乐解锁"板块的 `show` 改为 `false`：

```ts
show: false, // 原为 show: isElectron || isCapacitorAndroid
```

代码逻辑不受影响（默认开启），仅设置页不再显示开关。

## 六、真机验证指引（连接设备后执行）

1. 连接设备并开启 USB 调试，确认：`adb devices` 显示设备。
2. 安装（按设备架构选择，现代手机用 arm64）：
   ```bash
   adb install -r android/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk
   ```
3. 启动 App，等待约 5 秒（嵌入式服务器初始化），确认：
   - 首页可正常加载、可搜索歌曲（说明内置 API 已工作）；
   - 设置 → 播放 → "音乐解锁"开关可见且默认开启。
4. 实时查看关键日志：
   ```bash
   adb logcat -s NodeJS:* chromium:V AndroidRuntime:E | findstr /i "embedded listening error unblock"
   ```
   期望看到 `listening on http://127.0.0.1:1145/api`。
5. 播放一首 VIP/无版权歌曲，观察：
   - 播放页出现"解锁"标识（`statusStore.isUnlocked`）；
   - 日志出现 `🔓 解锁成功` 或 `🎧 解锁失败，回退官方试听`（任一均正常，不崩溃）。

**功能测试清单**：普通歌曲播放 / VIP 自动解锁 / 切歌预加载 / 后台锁屏续播 / 解锁开关可切换 / 播放失败降级试听无崩溃 / 断网重试恢复。

## 七、后续维护建议

- **外部音源失效**：编辑 `API/unblock/` 下的对应源（如 `kuwo.ts` 的搜索 URL、`bodian.ts` 的播放接口），更新为可用端点后重新 `pnpm build:android:node && pnpm prepare:android:embedded` 并重编 APK。
- **构建 release**：
  1. 在 `android/` 创建 `key.properties`（含 `storeFile/storePassword/keyAlias/keyPassword`）；
  2. `cd android && ./gradlew assembleRelease`；
  3. 产物在 `android/app/build/outputs/apk/release/`。
- **构建命令速查**（分步，避免全局 pnpm 损坏问题）：
  ```bash
  corepack pnpm build:web -- --mode mobile-embedded  # 或 vite build --mode mobile-embedded
  corepack pnpm exec cap sync android
  corepack pnpm build:android:node   # 打包 minify 嵌入式服务器
  corepack pnpm prepare:android:embedded
  cd android && gradlew.bat assembleDebug
  ```
