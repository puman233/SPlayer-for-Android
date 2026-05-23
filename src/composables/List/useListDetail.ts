import type { CoverType, SongType } from "@/types/main";
import { useStatusStore } from "@/stores";
import { useDevice } from "@/composables/useDevice";
import { prefetchListCovers } from "@/composables/useCoverCache";

export const useListDetail = () => {
  const statusStore = useStatusStore();
  const { isPhone } = useDevice();

  const detailData = ref<CoverType | null>(null);
  const listData = shallowRef<SongType[]>([]);
  const loading = ref<boolean>(true);

  /** 进入详情页 / 缓存命中时预热前 N 首歌曲封面，避免滚动时逐张走 IPC 抖动。 */
  const PREFETCH_SONG_COVER_LIMIT = 20;

  const getSongListHeight = (listScrolling: boolean) => {
    if (isPhone.value) {
      const phoneHeaderHeight = listScrolling ? 72 : 132;
      return Math.max(statusStore.mainContentHeight - phoneHeaderHeight, 320);
    }

    const normalHeight = 240;
    const smallHeight = 120;
    return statusStore.mainContentHeight - (listScrolling ? smallHeight : normalHeight);
  };

  const resetData = (resetList: boolean = true) => {
    detailData.value = null;
    if (resetList) {
      listData.value = [];
    }
  };

  const setDetailData = (data: CoverType | null) => {
    detailData.value = data;
  };

  const setListData = (data: SongType[]) => {
    listData.value = data;
    // 仅对首批 N 首做 prefetch；后续 append/replace 重复触发由 inFlight 去重，但首屏只关心前 20。
    if (data.length > 0) {
      prefetchListCovers(data, "covers", PREFETCH_SONG_COVER_LIMIT, "s");
    }
  };

  const appendListData = (data: SongType[]) => {
    const before = listData.value.length;
    listData.value = [...listData.value, ...data];
    // 仅当首批未填满预热配额时才补窗（继续滚动加载是用户行为驱动，不必激进预热）
    if (before < PREFETCH_SONG_COVER_LIMIT && data.length > 0) {
      const remain = PREFETCH_SONG_COVER_LIMIT - before;
      prefetchListCovers(data.slice(0, remain), "covers", remain, "s");
    }
  };

  const setLoading = (value: boolean) => {
    loading.value = value;
  };

  return {
    detailData,
    listData,
    loading,
    getSongListHeight,
    resetData,
    setDetailData,
    setListData,
    appendListData,
    setLoading,
  };
};
