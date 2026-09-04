import { ref } from "vue";

// 全局导航刷新信号：底部导航长按触发，当前页监听后重新拉取数据
const refreshSeq = ref(0);

/** 触发当前界面刷新 */
export const triggerViewRefresh = () => {
  refreshSeq.value++;
};

/** 供各 Tab 容器监听刷新信号 */
export const useViewRefresh = () => ({
  refreshSeq,
});
