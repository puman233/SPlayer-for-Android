import { mediaSessionManager } from "@/core/player/MediaSessionManager";
import { usePlayerController } from "@/core/player/PlayerController";
import { useDownloadManager } from "@/core/resource/DownloadManager";
import { useDataStore, useSettingStore, useShortcutStore, useStatusStore } from "@/stores";
import { TASKBAR_IPC_CHANNELS } from "@/types/shared";
import { isCapacitorAndroid, isElectron, isMac } from "@/utils/env";
import { printVersion } from "@/utils/log";
import { openUserAgreement } from "@/utils/modal";
import { useEventListener } from "@vueuse/core";
import { debounce } from "lodash-es";
import { onMounted, watch } from "vue";

/** 最终聚焦主窗口的延迟时间（毫秒） */
const FINAL_FOCUS_DELAY_MS = 500;
// 通知/悬浮窗权限已从项目移除（非必要权限），不再于启动时请求
const requestInitialAndroidPermissions = async () => {
  return;
};

const runAfterStartup = (cb: () => void) => {
  setTimeout(cb, 0);
};

/**
 * 应用初始化时需要执行的操作
 */
export const useInit = () => {
  // init pinia-data
  const dataStore = useDataStore();
  const statusStore = useStatusStore();
  const settingStore = useSettingStore();
  const shortcutStore = useShortcutStore();

  const player = usePlayerController();
  const downloadManager = useDownloadManager();

  // 事件监听
  initEventListener();

  onMounted(async () => {
    // 检查并执行设置迁移
    settingStore.checkAndMigrate();
    // 加载本地持久化数据：必须在 player.playSong 之前完成，
    // 让 IDB 连接早建立、读取早开始；后续 playSong 走网络分支与 UI 渲染天然并行。
    await dataStore.loadData();
    // 初始化 MediaSession
    mediaSessionManager.init();
    // 初始化播放器
    player.playSong({
      autoPlay: settingStore.autoPlay,
      seek: settingStore.memoryLastSeek ? statusStore.currentTime : 0,
    });
    // 同步播放模式
    player.playModeSyncIpc();
    // 同步 Android 媒体队列上下文（依赖 dataStore.userLikeData / playList，已加载完成）
    if (isCapacitorAndroid) void player.syncAndroidPlaybackContext();
    downloadManager.init();

    // 监听设置变化以更新 ReplayGain（依赖 player 已完成基础初始化，放在 onMounted）
    watch(
      () => [settingStore.enableReplayGain, settingStore.replayGainMode],
      () => player.applyReplayGain(),
    );

    // 非关键操作延迟到启动任务之后执行，后台 WebView 也需要恢复定时器
    runAfterStartup(() => {
      // 打印版本信息
      printVersion();
      // 用户协议
      openUserAgreement(() => void requestInitialAndroidPermissions());
      // 初始化自动关闭定时器
      if (statusStore.autoClose.enable) {
        const { endTime, time } = statusStore.autoClose;
        const now = Date.now();
        if (endTime > now) {
          const realRemainTime = Math.ceil((endTime - now) / 1000);
          player.startAutoCloseTimer(time, realRemainTime);
        } else {
          statusStore.autoClose.enable = false;
          statusStore.autoClose.remainTime = time * 60;
          statusStore.autoClose.endTime = 0;
        }
      }

      if (isElectron) {
        void (async () => {
          if (!window.electron) return;
          shortcutStore.registerAllShortcuts();
          window.electron.ipcRenderer.send("win-loaded");
          const taskbarConfig = (await window.electron.ipcRenderer.invoke(
            TASKBAR_IPC_CHANNELS.GET_OPTION,
          )) as { enabled?: boolean };
          statusStore.showTaskbarLyric =
            taskbarConfig?.enabled ?? statusStore.showTaskbarLyric ?? false;
          window.electron.ipcRenderer.send(
            TASKBAR_IPC_CHANNELS.SET_OPTION,
            { enabled: statusStore.showTaskbarLyric },
            true,
          );
          window.electron.ipcRenderer.send("desktop-lyric:toggle", statusStore.showDesktopLyric);
          if (settingStore.checkUpdateOnStart)
            window.electron.ipcRenderer.send("check-update", false);
          if (isMac && settingStore.macos.statusBarLyric.enabled) {
            window.electron.ipcRenderer.send(TASKBAR_IPC_CHANNELS.REQUEST_DATA);
          }
          if (statusStore.showDesktopLyric) {
            setTimeout(() => {
              window.electron?.ipcRenderer.send("win-show-main");
            }, FINAL_FOCUS_DELAY_MS);
          }
        })().catch((err) => {
          console.error("Electron 初始化阶段出错:", err);
        });
      }
    });
  });
};

// 事件监听
const initEventListener = () => {
  // 键盘事件
  useEventListener(window, "keydown", keyDownEvent);
};

// 键盘事件
const keyDownEvent = debounce((event: KeyboardEvent) => {
  const player = usePlayerController();
  const shortcutStore = useShortcutStore();
  const statusStore = useStatusStore();
  const target = event.target as HTMLElement;
  // 排除元素
  const extendsDom = ["input", "textarea"];
  if (extendsDom.includes(target.tagName.toLowerCase())) return;
  event.preventDefault();
  event.stopPropagation();
  // 获取按键信息
  const key = event.code;
  const isCtrl = event.ctrlKey || event.metaKey;
  const isShift = event.shiftKey;
  const isAlt = event.altKey;
  // 循环注册快捷键
  for (const [shortcutKey, shortcut] of Object.entries(shortcutStore.shortcutList)) {
    const shortcutParts = shortcut.shortcut.split("+");
    // 标志位
    let match = true;
    // 检查是否包含修饰键
    const hasCmdOrCtrl = shortcutParts.includes("CmdOrCtrl");
    const hasShift = shortcutParts.includes("Shift");
    const hasAlt = shortcutParts.includes("Alt");
    // 检查修饰键匹配
    if (hasCmdOrCtrl && !isCtrl) match = false;
    if (hasShift && !isShift) match = false;
    if (hasAlt && !isAlt) match = false;
    // 如果快捷键定义中没有修饰键，确保没有按下任何修饰键
    if (!hasCmdOrCtrl && !hasShift && !hasAlt) {
      if (isCtrl || isShift || isAlt) match = false;
    }
    // 检查实际按键
    const mainKey = shortcutParts.find(
      (part: string) => part !== "CmdOrCtrl" && part !== "Shift" && part !== "Alt",
    );
    if (mainKey !== key) match = false;
    if (match && shortcutKey) {
      console.log(shortcutKey, `快捷键触发: ${shortcut.name}`);
      switch (shortcutKey) {
        case "playOrPause":
          player.playOrPause();
          break;
        case "playPrev":
          player.nextOrPrev("prev");
          break;
        case "playNext":
          player.nextOrPrev("next");
          break;
        case "seekForward":
          player.seekBy(5000);
          break;
        case "seekBackward":
          player.seekBy(-5000);
          break;
        case "volumeUp":
          player.setVolume("up");
          break;
        case "volumeDown":
          player.setVolume("down");
          break;
        case "toggle-desktop-lyric":
          player.toggleDesktopLyric();
          break;
        case "openPlayer":
          // 打开播放界面（任意界面）
          statusStore.showFullPlayer = true;
          break;
        case "closePlayer":
          // 关闭播放界面（仅在播放界面时）
          if (statusStore.showFullPlayer) {
            statusStore.showFullPlayer = false;
          }
          break;
        case "openPlayList":
          // 打开播放列表（任意界面）
          statusStore.playListShow = !statusStore.playListShow;
          break;
        default:
          break;
      }
    }
  }
}, 100);
