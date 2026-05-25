import type { InjectionKey } from "vue";

/**
 * 控制全屏播放器顶部 / 底部控制栏自动隐藏的 hold 接口
 *
 * 用于：弹层（如快捷菜单 popover）打开期间，鼠标离开 PlayerControl 移动到 body 下
 * 的 popover panel 时，需要保持 playerMetaShow=true，避免控制栏隐藏导致 trigger
 * DOM 消失、popover 定位失效。
 *
 * 使用引用计数模式，支持多个 hold 持有者并存。
 */
export interface PlayerMetaHold {
  /** 获取 hold：计数 +1，立即取消任何 pending 的隐藏定时器 */
  acquire: () => void;
  /** 释放 hold：计数 -1，若清零且开启了 autoHide 则重启隐藏定时器 */
  release: () => void;
}

export const PLAYER_META_HOLD_KEY: InjectionKey<PlayerMetaHold> = Symbol("PlayerMetaHold");
