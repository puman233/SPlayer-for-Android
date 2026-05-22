import { markRaw, toRaw } from "vue";
import { defineStore } from "pinia";
import type {
  SongType,
  CoverType,
  UserDataType,
  UserLikeDataType,
  CatType,
  LoginType,
  SongLevelType,
  AccountType,
} from "@/types/main";
import { playlistCatlist } from "@/api/playlist";
import { cloneDeep, isEmpty } from "lodash-es";
import { isLogin } from "@/utils/auth";
import { formatCategoryList } from "@/utils/format";
import localforage from "localforage";

interface ListState {
  playList: SongType[];
  originalPlayList: SongType[];
  historyList: SongType[];
  cloudPlayList: SongType[];
  searchHistory: string[];
  localPlayList: CoverType[];
  userLoginStatus: boolean;
  loginType: LoginType;
  userData: UserDataType;
  userList: AccountType[];
  userLikeData: UserLikeDataType;
  likeSongsList: {
    detail: CoverType;
    data: SongType[];
  };
  catData: {
    type: Record<number, string>;
    cats: CatType[];
    hqCats: CatType[];
  };
  /** 正在下载的歌曲列表 */
  downloadingSongs: Array<{
    /** 歌曲信息 */
    song: SongType;
    /** 音质 */
    quality: SongLevelType;
    /** 状态：下载中 / 等待中 / 失败 */
    status: "downloading" | "waiting" | "failed";
    /** 下载进度 */
    progress: number;
    /** 已传输大小 */
    transferred: string;
    /** 总大小 */
    totalSize: string;
  }>;
}

type UserDataKeys = keyof ListState["userLikeData"];

// 加载期脏标记：onMounted 内 await loadData 不阻塞 router-view 渲染，
// 用户在加载期间仍可能触发写操作；记录被写过的 key，避免随后被读到的旧值覆盖。
let isLoadingData = false;
const dirtyMusicKeys = new Set<string>();
const dirtyUserKeys = new Set<UserDataKeys>();
const markMusicDirty = (key: string) => {
  if (isLoadingData) dirtyMusicKeys.add(key);
};
const markUserDirty = (key: UserDataKeys) => {
  if (isLoadingData) dirtyUserKeys.add(key);
};

// localforage 实例延迟初始化，避免模块解析阶段创建 IndexedDB 连接阻塞冷启动
let _musicDB: ReturnType<typeof localforage.createInstance> | null = null;
const getMusicDB = () => {
  if (!_musicDB) {
    _musicDB = localforage.createInstance({
      name: "music-data",
      description: "List data of the application",
      storeName: "music",
    });
  }
  return _musicDB;
};

let _userDB: ReturnType<typeof localforage.createInstance> | null = null;
const getUserDB = () => {
  if (!_userDB) {
    _userDB = localforage.createInstance({
      name: "user-data",
      description: "User data of the application",
      storeName: "user",
    });
  }
  return _userDB;
};

let _backgroundDB: ReturnType<typeof localforage.createInstance> | null = null;
const getBackgroundDB = () => {
  if (!_backgroundDB) {
    _backgroundDB = localforage.createInstance({
      name: "background-data",
      description: "Background image data",
      storeName: "background",
    });
  }
  return _backgroundDB;
};

export const useDataStore = defineStore("data", {
  state: (): ListState => ({
    // 播放列表
    playList: [],
    // 原始播放列表
    originalPlayList: [],
    // 播放历史
    historyList: [],
    // 搜索历史
    searchHistory: [],
    // 本地歌单
    localPlayList: [],
    // 云盘歌单
    cloudPlayList: [],
    // 登录状态
    userLoginStatus: false,
    // 登录方式
    loginType: "qr",
    // 用户数据
    userData: {
      userId: 0,
      userType: 0,
      vipType: 0,
      name: "",
    },
    // 用户列表（多账号）
    userList: [],
    // 用户喜欢数据
    userLikeData: {
      songs: [],
      playlists: [],
      artists: [],
      albums: [],
      mvs: [],
      djs: [],
    },
    // 我喜欢的音乐
    likeSongsList: {
      detail: {
        id: 0,
        name: "我喜欢的音乐",
        cover: "/images/album.jpg?asset",
      },
      data: [],
    },
    // 分类数据
    catData: {
      type: {},
      cats: [],
      hqCats: [],
    },
    // 正在下载的歌曲列表
    downloadingSongs: [],
  }),
  getters: {
    // 是否为喜欢歌曲
    isLikeSong: (state) => (id: number) => state.userLikeData.songs.includes(id),
  },
  actions: {
    /**
     * 加载本地持久化数据：playList / 历史 / 喜欢列表 / 用户喜欢数据等。
     * 必须在 player.playSong 之前 await 完成，
     * 否则用户秒进 /like、/history 等依赖 userLikeData / historyList 的页面会看到空状态闪烁。
     *
     * 加载期间用 dirtyMusicKeys / dirtyUserKeys 防御并发写入：
     * 用户在 await 期间通过 UI 触发了 setPlayList 等写操作时，
     * 不会被随后到来的旧值 getItem 结果覆盖。
     */
    async loadData() {
      if (isLoadingData) return;
      isLoadingData = true;
      dirtyMusicKeys.clear();
      dirtyUserKeys.clear();
      try {
        // music-data 数组类键白名单
        const MUSIC_ARRAY_KEYS = [
          "playList",
          "originalPlayList",
          "historyList",
          "cloudPlayList",
          "localPlayList",
          "downloadingSongs",
        ] as const;
        // music-data 其它结构键
        const MUSIC_OTHER_KEYS = ["likeSongsList"] as const;
        const musicAllowed = new Set<string>([...MUSIC_ARRAY_KEYS, ...MUSIC_OTHER_KEYS]);
        // user-data 键白名单
        const USER_ALLOWED_KEYS = new Set<UserDataKeys>([
          "songs",
          "playlists",
          "artists",
          "albums",
          "mvs",
          "djs",
        ]);

        // music-data
        const musicDataKeys = await getMusicDB().keys();
        await Promise.all(
          musicDataKeys.map(async (key) => {
            if (!musicAllowed.has(key)) return;
            const data = await getMusicDB().getItem(key);
            if (dirtyMusicKeys.has(key)) return;
            if ((MUSIC_ARRAY_KEYS as readonly string[]).includes(key)) {
              (this as unknown as Record<string, unknown>)[key] = data
                ? markRaw(data as object)
                : [];
            } else if (key === "likeSongsList" && data) {
              // 特殊处理嵌套对象中的 data
              const listData = data as ListState["likeSongsList"];
              this.likeSongsList = {
                detail: listData.detail,
                data: markRaw(listData.data || []),
              };
            }
          }),
        );

        // user-data
        const userDataKeys = await getUserDB().keys();
        await Promise.all(
          userDataKeys.map(async (key) => {
            const userDataKey = key as UserDataKeys;
            if (!USER_ALLOWED_KEYS.has(userDataKey)) return;
            const data = await getUserDB().getItem(key);
            if (dirtyUserKeys.has(userDataKey)) return;
            (this.userLikeData as Record<string, unknown>)[key] = data;
          }),
        );
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        isLoadingData = false;
        dirtyMusicKeys.clear();
        dirtyUserKeys.clear();
      }
    },
    /**
     * 更新播放列表
     * @param data 播放列表
     * @returns 插入的歌曲索引
     */
    async setPlayList(data: SongType | SongType[]): Promise<number> {
      try {
        let newList: SongType[] = [];
        let index = 0;
        // 若为列表
        if (Array.isArray(data)) {
          newList = data;
          index = 0;
        }
        // 若为单曲
        else {
          const currentList = toRaw(this.playList);
          // 歌曲去重
          newList = currentList.filter((s) => s.id !== data.id);
          // 添加到歌单末尾
          newList.push(data);
          // 获取索引
          index = newList.length - 1;
        }
        markMusicDirty("playList");
        this.playList = markRaw(newList);
        await getMusicDB().setItem("playList", cloneDeep(toRaw(newList)));
        return index;
      } catch (error) {
        console.error("Error updating playlist:", error);
        throw error;
      }
    },
    /**
     * 设置原始播放列表
     * @param data 原始播放列表
     */
    async setOriginalPlayList(data: SongType[]): Promise<void> {
      markMusicDirty("originalPlayList");
      this.originalPlayList = markRaw(data);
      await getMusicDB().setItem("originalPlayList", cloneDeep(toRaw(data)));
    },
    /**
     * 获取原始播放列表
     * @returns 原始播放列表
     */
    async getOriginalPlayList(): Promise<SongType[] | null> {
      // 检查内存中是否有数据
      if (Array.isArray(this.originalPlayList) && this.originalPlayList.length > 0) {
        return this.originalPlayList;
      }
      // 从 DB 获取
      const data = (await getMusicDB().getItem("originalPlayList")) as SongType[] | null;
      if (Array.isArray(data) && data.length > 0) {
        this.originalPlayList = markRaw(data);
        return data;
      }
      return null;
    },
    /**
     * 清除原始播放列表
     */
    async clearOriginalPlayList(): Promise<void> {
      markMusicDirty("originalPlayList");
      this.originalPlayList = [];
      await getMusicDB().setItem("originalPlayList", []);
    },
    /**
     * 设置下一首播放歌曲
     * @param song 歌曲
     * @param index 插入位置
     * @returns 插入的歌曲索引
     */
    async setNextPlaySong(song: SongType, index: number): Promise<number> {
      // 若为空,则直接添加
      if (this.playList.length === 0) {
        markMusicDirty("playList");
        this.playList = [song];
        await getMusicDB().setItem("playList", cloneDeep(this.playList));
        return 0;
      }
      // 避免直接修改 state
      const newList = [...this.playList];
      // 在当前播放位置之后插入歌曲
      const indexAdd = index + 1;
      newList.splice(indexAdd, 0, song);
      // 移除重复的歌曲（如果存在）
      const finalList = newList.filter((item, idx) => idx === indexAdd || item.id !== song.id);
      // 更新本地存储
      markMusicDirty("playList");
      this.playList = markRaw(finalList);
      await getMusicDB().setItem("playList", cloneDeep(finalList));
      // 返回刚刚插入的歌曲索引
      return finalList.indexOf(song);
    },
    /**
     * 设置播放历史
     * @param song 歌曲
     */
    async setHistory(song: SongType) {
      try {
        let historyList: SongType[] = (await getMusicDB().getItem("historyList")) || [];
        if (!Array.isArray(historyList)) historyList = [];
        // 过滤旧的同名歌曲，把新的放到第一位
        const updatedList = [song, ...historyList.filter((item) => item.id !== song.id)];
        // 最多 500 首
        if (updatedList.length > 500) updatedList.splice(500);
        markMusicDirty("historyList");
        const rawList = updatedList.map((s) => toRaw(s));
        await getMusicDB().setItem("historyList", rawList);
        this.historyList = markRaw(updatedList);
      } catch (error) {
        console.error("Error updating history:", error);
        throw error;
      }
    },
    /**
     * 清除播放历史
     */
    async clearHistory(): Promise<void> {
      try {
        markMusicDirty("historyList");
        await getMusicDB().setItem("historyList", []);
        this.historyList = [];
      } catch (error) {
        console.error("Error clearing history:", error);
        throw error;
      }
    },
    /**
     * 设置我喜欢的音乐
     * @param detail 歌曲详情
     * @param data 歌曲列表
     */
    async setLikeSongsList(detail: CoverType, data: SongType[]) {
      const listData = {
        detail: { ...detail },
        data: toRaw(data),
      };
      markMusicDirty("likeSongsList");
      this.likeSongsList = { detail: detail, data: markRaw(data) };
      await getMusicDB().setItem("likeSongsList", cloneDeep(toRaw(listData)));
    },
    /**
     * 获取我喜欢的歌单数据
     * @returns 我喜欢的歌单数据
     */
    async getUserLikePlaylist() {
      if (!isLogin() || !this.userData.userId) return;
      const result = await getMusicDB().getItem("likeSongsList");
      return result as { detail: CoverType; data: SongType[] } | null;
    },
    /**
     * 设置云盘歌单
     * @param data 云盘歌单
     */
    async setCloudPlayList(data: SongType[]) {
      markMusicDirty("cloudPlayList");
      this.cloudPlayList = markRaw(data);
      await getMusicDB().setItem("cloudPlayList", cloneDeep(toRaw(data)));
    },
    /**
     * 设置用户喜欢数据
     * @param name 数据名称
     * @param data 用户喜欢数据
     */
    async setUserLikeData<K extends UserDataKeys>(
      name: K,
      data: ListState["userLikeData"][K],
    ): Promise<void> {
      try {
        markUserDirty(name);
        await getUserDB().setItem(name, toRaw(data));
        this.userLikeData[name] = data;
      } catch (error) {
        console.error("Error updating user data:", error);
        throw error;
      }
    },
    /**
     * 清除用户数据
     */
    async clearUserData() {
      try {
        this.userLoginStatus = false;
        this.loginType = "qr";
        this.userData = {
          userId: 0,
          userType: 0,
          vipType: 0,
          name: "",
        };
        await Promise.all(
          Object.keys(this.userLikeData).map(async (key) => {
            const userDataKey = key as UserDataKeys;
            await this.setUserLikeData(userDataKey, []);
            this.userLikeData[userDataKey] = [];
          }),
        );
      } catch (error) {
        console.error("Error clearing user data:", error);
        throw error;
      }
    },
    /**
     * 删除数据库
     * @param name 数据库名称
     */
    async deleteDB(name?: string): Promise<void> {
      try {
        if (name) {
          await localforage.dropInstance({ name });
          console.log(`Dropped ${name} database`);
          return;
        }
        await getMusicDB().clear();
        await getUserDB().clear();
        console.log("All databases cleared");
      } catch (error) {
        console.error("Error deleting database:", error);
        throw error;
      }
    },
    /**
     * 获取歌单分类
     * @returns 歌单分类
     */
    async getPlaylistCatList() {
      if (!isEmpty(this.catData.cats) && !isEmpty(this.catData.hqCats)) return;
      // 获取歌单分类
      try {
        const [catsRes, hqCatsRes] = await Promise.all([playlistCatlist(), playlistCatlist(true)]);
        console.log(catsRes, hqCatsRes);
        this.catData = {
          type: catsRes.categories,
          cats: formatCategoryList(catsRes.sub),
          hqCats: formatCategoryList(hqCatsRes.tags),
        };
      } catch (error) {
        console.error("Error getting playlist cat list:", error);
        throw error;
      }
    },
    /**
     * 添加正在下载的歌曲
     * @param song 歌曲
     * @param quality 音质
     */
    async addDownloadingSong(song: SongType, quality: SongLevelType) {
      // 检查是否已存在
      const exists = this.downloadingSongs.find((item) => item.song.id === song.id);
      if (exists) return;
      this.downloadingSongs.push({
        song: cloneDeep(song),
        quality,
        status: "waiting",
        progress: 0,
        transferred: "0MB",
        totalSize: "0MB",
      });
      // 保存到本地存储
      markMusicDirty("downloadingSongs");
      await getMusicDB().setItem("downloadingSongs", cloneDeep(this.downloadingSongs));
    },
    /**
     * 更新下载状态
     * @param songId 歌曲ID
     * @param status 下载状态
     */
    updateDownloadStatus(songId: number, status: "downloading" | "waiting" | "failed") {
      const index = this.downloadingSongs.findIndex((item) => item.song.id === songId);
      if (index !== -1) {
        this.downloadingSongs[index].status = status;
        // 强制触发响应式更新 (Fix: 下一首歌曲状态更新UI不变化的问题)
        this.downloadingSongs = [...this.downloadingSongs];
        markMusicDirty("downloadingSongs");
      }
    },
    // 更新下载进度
    updateDownloadProgress(
      songId: number,
      progress: number,
      transferred: string,
      totalSize: string,
    ) {
      const item = this.downloadingSongs.find((item) => item.song.id === songId);
      if (item) {
        item.progress = progress;
        item.transferred = transferred;
        item.totalSize = totalSize;
        markMusicDirty("downloadingSongs");
        // 进度更新过于频繁，不需要强制更新整个数组，以免影响性能
      }
    },
    // 移除正在下载的歌曲（下载失败时）
    async removeDownloadingSong(songId: number) {
      const index = this.downloadingSongs.findIndex((item) => item.song.id === songId);
      if (index !== -1) {
        this.downloadingSongs.splice(index, 1);
        markMusicDirty("downloadingSongs");
        await getMusicDB().setItem("downloadingSongs", cloneDeep(this.downloadingSongs));
      }
    },
    // 标记下载失败（保留在列表中）
    async markDownloadFailed(songId: number) {
      const index = this.downloadingSongs.findIndex((item) => item.song.id === songId);
      if (index !== -1) {
        this.downloadingSongs[index].status = "failed";
        this.downloadingSongs[index].progress = 0;
        this.downloadingSongs[index].transferred = "0MB";
        this.downloadingSongs[index].totalSize = "0MB";
        this.downloadingSongs = [...this.downloadingSongs];
        markMusicDirty("downloadingSongs");
        await getMusicDB().setItem("downloadingSongs", cloneDeep(this.downloadingSongs));
      }
    },
    // 重置下载任务状态（用于重试）
    resetDownloadingSong(songId: number) {
      const index = this.downloadingSongs.findIndex((item) => item.song.id === songId);
      if (index !== -1) {
        this.downloadingSongs[index].status = "waiting";
        this.downloadingSongs[index].progress = 0;
        this.downloadingSongs[index].transferred = "0MB";
        this.downloadingSongs[index].totalSize = "0MB";
        this.downloadingSongs = [...this.downloadingSongs];
        markMusicDirty("downloadingSongs");
      }
    },
    /**
     * 保存背景图
     * @param blob 图片 Blob 数据
     */
    async saveBackgroundImage(blob: Blob): Promise<void> {
      try {
        await getBackgroundDB().setItem("image", blob);
      } catch (error) {
        console.error("Error saving background image:", error);
        throw error;
      }
    },
    /**
     * 获取背景图
     * @returns Blob 数据
     */
    async getBackgroundImage(): Promise<Blob | null> {
      try {
        const data = await getBackgroundDB().getItem<Blob>("image");
        return data || null;
      } catch (error) {
        console.error("Error getting background image:", error);
        return null;
      }
    },
    /**
     * 清除背景图
     */
    async clearBackgroundImage(): Promise<void> {
      try {
        await getBackgroundDB().removeItem("image");
      } catch (error) {
        console.error("Error clearing background image:", error);
        throw error;
      }
    },
  },
  // 持久化
  persist: {
    key: "data-store",
    storage: localStorage,
    pick: ["userLoginStatus", "loginType", "userData", "userList", "searchHistory", "catData"],
  },
});
