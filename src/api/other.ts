import request from "@/utils/request";

// 获取仓库更新日志
export const updateLog = () => {
  return request({
    baseURL: "https://api.github.com",
    withCredentials: false,
    url: "/repos/puman233/SPlayer-for-Android/releases",
    params: { noCookie: true },
  });
};
