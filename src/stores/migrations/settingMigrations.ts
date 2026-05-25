import { keywords, regexes } from "@/assets/data/exclude";
import { SongUnlockServer } from "@/core/player/SongManager";
import { defaultAMLLDbServer } from "@/utils/meta";
import type { SettingState } from "../setting";

/**
 * 当前设置 Schema 版本号
 */
export const CURRENT_SETTING_SCHEMA_VERSION = 21;

/**
 * 迁移函数类型
 * 迁移函数只需返回需要更新的字段，系统会自动合并到原有状态
 */
export type MigrationFunction = (state: Partial<SettingState>) => Partial<SettingState>;

/**
 * 迁移脚本映射表
 * key: 目标版本号
 * value: 从上一版本迁移到该版本的函数
 */
export const settingMigrations: Record<number, MigrationFunction> = {
  3: () => {
    return {
      // ttml 同步
      enableTTMLLyric: false,
      amllDbServer: defaultAMLLDbServer,
    };
  },
  4: () => {
    return {
      songUnlockServer: [
        { key: SongUnlockServer.BODIAN, enabled: true },
        { key: SongUnlockServer.GEQUBAO, enabled: true },
        { key: SongUnlockServer.NETEASE, enabled: true },
        { key: SongUnlockServer.KUWO, enabled: false },
      ],
    };
  },
  5: (state) => {
    // 迁移排除歌词关键字和正则表达式到用户自定义字段
    // 如果旧字段存在且不为空，则迁移到新字段
    // 定义旧版本的设置状态类型（包含已废弃的字段）
    interface OldSettingState extends Partial<SettingState> {
      excludeKeywords?: string[];
      excludeRegexes?: string[];
    }

    const oldState = state as OldSettingState;
    const oldKeywords = oldState.excludeKeywords;
    const oldRegexes = oldState.excludeRegexes;

    // 如果旧字段包含默认值，则只保留用户自定义的部分
    const userKeywords: string[] = [];
    const userRegexes: string[] = [];

    if (oldKeywords && Array.isArray(oldKeywords)) {
      // 过滤掉默认关键字，只保留用户自定义的
      oldKeywords.forEach((keyword) => {
        if (!keywords.includes(keyword)) {
          userKeywords.push(keyword);
        }
      });
    }

    if (oldRegexes && Array.isArray(oldRegexes)) {
      // 过滤掉默认正则，只保留用户自定义的
      oldRegexes.forEach((regex) => {
        if (!regexes.includes(regex)) {
          userRegexes.push(regex);
        }
      });
    }

    return {
      // 这些字段在 Schema Version 8 时被重命名，导致类型检查报错
      excludeUserKeywords: userKeywords,
      excludeUserRegexes: userRegexes,
    } as Partial<SettingState>;
  },
  6: (state) => {
    interface OldSettingState extends Partial<SettingState> {
      enableTTMLLyric?: boolean;

      hideDiscover?: boolean;
      hidePersonalFM?: boolean;
      hideRadioHot?: boolean;
      hideLike?: boolean;
      hideCloud?: boolean;
      hideDownload?: boolean;
      hideLocal?: boolean;
      hideHistory?: boolean;
      hideUserPlaylists?: boolean;
      hideLikedPlaylists?: boolean;
      hideHeartbeatMode?: boolean;
    }
    const oldState = state as OldSettingState;

    return {
      enableOnlineTTMLLyric: oldState.enableTTMLLyric,

      sidebarHide: {
        hideDiscover: oldState.hideDiscover || false,
        hidePersonalFM: oldState.hidePersonalFM || false,
        hideRadioHot: oldState.hideRadioHot || false,
        hideLike: oldState.hideLike || false,
        hideCloud: oldState.hideCloud || false,
        hideDownload: oldState.hideDownload || false,
        hideLocal: oldState.hideLocal || false,
        hideHistory: oldState.hideHistory || false,
        hideUserPlaylists: oldState.hideUserPlaylists || false,
        hideLikedPlaylists: oldState.hideLikedPlaylists || false,
        hideHeartbeatMode: oldState.hideHeartbeatMode || false,
      },
    };
  },
  7: (state) => {
    interface OldSettingState extends Omit<Partial<SettingState>, "discordRpc"> {
      discordRpc?: {
        enabled: boolean;
        showWhenPaused: boolean;
        displayMode: string;
      };
    }

    const oldState = state as OldSettingState;
    const oldRpc = oldState.discordRpc;

    if (!oldRpc || !oldRpc.displayMode) {
      return {};
    }

    const modeMap: Record<string, "Name" | "State" | "Details"> = {
      name: "Name",
      state: "State",
      details: "Details",
    };

    const currentMode = oldRpc.displayMode;

    if (Object.hasOwn(modeMap, currentMode)) {
      return {
        discordRpc: {
          enabled: oldRpc.enabled,
          showWhenPaused: oldRpc.showWhenPaused,
          displayMode: modeMap[currentMode],
        },
      };
    }

    return {};
  },
  8: (state) => {
    interface OldSettingState extends Partial<SettingState> {
      enableExcludeTTML?: boolean;
      enableExcludeLocalLyrics?: boolean;
      excludeUserKeywords?: string[];
      excludeUserRegexes?: string[];
    }

    const oldState = state as OldSettingState;

    return {
      enableExcludeLyricsTTML: oldState.enableExcludeTTML,
      enableExcludeLyricsLocal: oldState.enableExcludeLocalLyrics,
      excludeLyricsUserKeywords: oldState.excludeUserKeywords,
      excludeLyricsUserRegexes: oldState.excludeUserRegexes,
    };
  },
  9: (state) => {
    interface OldSettingState extends Partial<SettingState> {
      preferQQMusicLyric?: boolean;
    }
    const oldState = state as OldSettingState;
    const preferQM = oldState.preferQQMusicLyric ?? false;

    return {
      enableQQMusicLyric: preferQM,
      lyricPriority: preferQM ? "qm" : "auto",
    };
  },
  10: (state) => {
    interface OldSettingState extends Partial<SettingState> {
      clearSearchOnBlur?: boolean;
    }
    const oldState = state as OldSettingState;
    return oldState.clearSearchOnBlur === true ? { searchInputBehavior: "clear" } : {};
  },
  11: () => {
    return {
      uncensorMaskedProfanity: false,
    };
  },
  12: () => {
    return {
      androidMediaControllerEnabled: true,
      androidMediaControllerDesktopLyricEnabled: false,
    };
  },
  13: () => {
    return {
      androidAllowMixWithOthers: true,
    };
  },
  14: () => {
    return {
      androidLyricDirectories: [],
      androidLyricIndexMap: {},
      androidLyricScanMeta: {
        lastScanAt: 0,
        totalFiles: 0,
        matchedFiles: 0,
        duplicateIds: 0,
        failedFiles: 0,
      },
    };
  },
  15: () => {
    return {
      androidDownloadDirectoryUri: "",
    };
  },
  16: () => {
    return {
      androidLocalMusicDirectories: [],
    };
  },
  17: () => {
    return {
      pageZoom: 100,
    };
  },
  18: () => {
    // 旧版 pageZoom 在 Android 是通过 viewport initial-scale 改 innerWidth 来切换布局，
    // 新版 phonePortraitPageZoom / padPageZoom 是 CSS 缩放，语义完全不同；
    // 若直接迁移旧值会导致老用户升级后 UI 被等比缩小，故强制重置为 100。
    return {
      phonePortraitPageZoom: 100,
      padPageZoom: 100,
    };
  },
  19: () => {
    return {
      androidFullscreenSafeAreaOptimize: true,
    };
  },
  20: (state) => {
    // 初始化动态背景记忆字段：
    //  - 若用户当前背景不是 animation，就记录作为上次非 animation 值；
    //  - 否则默认 blur（与 store 默认一致）。
    // amllAnimationBgEverActivated 默认 false，老用户首次从快捷菜单打开动态背景时仍会被默认激活低频脉动。
    const cur = state.playerBackgroundType;
    return {
      lastNonAnimationPlayerBg: cur && cur !== "animation" ? cur : "blur",
      amllAnimationBgEverActivated: false,
    };
  },
  21: () => {
    // 横屏沉浸式新增字号 / 封面 X 偏移 / 歌词内边距三项
    return {
      lyricFontSizeLandscape: 24,
      landscapeCoverOffsetX: 52,
      landscapeLyricPaddingX: 58,
    };
  },
};
