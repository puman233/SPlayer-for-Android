<template>
  <div class="login">
    <img src="/icons/favicon.png?asset" alt="logo" class="logo" />
    <n-tabs class="login-tabs" default-value="login-qr" type="segment" animated>
      <n-tab-pane name="login-qr" tab="扫码登录">
        <LoginQRCode :pause="qrPause" @saveLogin="saveLogin" />
      </n-tab-pane>
      <n-tab-pane name="login-phone" tab="验证码登录">
        <LoginPhone @saveLogin="saveLogin" />
      </n-tab-pane>
    </n-tabs>
    <n-flex align="center" class="other">
      <n-button
        v-if="!disableUid"
        :focusable="false"
        size="small"
        quaternary
        round
        @click="specialLogin('uid')"
      >
        UID 登录
      </n-button>
      <n-divider v-if="!disableUid" vertical />
      <n-button :focusable="false" size="small" quaternary round @click="specialLogin('cookie')">
        Cookie 登录
      </n-button>
    </n-flex>
    <n-button :focusable="false" class="close" strong secondary round @click="emit('close')">
      <template #icon>
        <SvgIcon name="WindowClose" />
      </template>
      取消
    </n-button>
  </div>
</template>

<script setup lang="ts">
import { userAccount, userDetail, userSubcount } from "@/api/user";
import { setCookies } from "@/utils/cookie";
import { updateSpecialUserData, updateUserData } from "@/utils/auth";
import { useDataStore } from "@/stores";
import { LoginType } from "@/types/main";
import LoginUID from "./LoginUID.vue";
import LoginCookie from "./LoginCookie.vue";

const props = defineProps<{
  force?: boolean;
  disableUid?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  success: [];
}>();

const dataStore = useDataStore();
const qrPause = ref(false);

const hydrateCoreUserData = async () => {
  const accountResult = await userAccount();
  const profile = accountResult?.profile;
  const userId = profile?.userId;

  if (!userId) {
    throw new Error("Missing user profile after login");
  }

  const [detailResult, subcountResult] = await Promise.all([userDetail(userId), userSubcount()]);
  const userData = Object.assign(profile, detailResult);

  dataStore.userData = {
    userId,
    userType: userData.userType,
    vipType: userData.vipType,
    name: userData.nickname,
    level: userData.level,
    avatarUrl: userData.avatarUrl,
    backgroundUrl: userData.backgroundUrl,
    createTime: userData.createTime,
    createDays: userData.createDays,
    artistCount: subcountResult?.artistCount,
    djRadioCount: subcountResult?.djRadioCount,
    mvCount: subcountResult?.mvCount,
    subPlaylistCount: subcountResult?.subPlaylistCount,
    createdPlaylistCount: subcountResult?.createdPlaylistCount,
  };
};

const saveLogin = async (loginData: any, type: LoginType = "qr") => {
  if (!loginData || loginData.code !== 200) {
    window.$message.error(loginData?.msg ?? loginData?.message ?? "账号或密码错误，请重试");
    return;
  }

  emit("close");
  dataStore.userLoginStatus = true;
  dataStore.loginType = type;

  if (type !== "uid") {
    setCookies(loginData.cookie);
  }

  localStorage.setItem("lastLoginTime", Date.now().toString());

  try {
    if (type !== "uid") {
      await hydrateCoreUserData();
      void updateUserData().catch((error) => {
        console.error("Deferred user sync failed:", error);
      });
    } else {
      await updateSpecialUserData(loginData?.profile);
    }
    window.$message.success("登录成功");
  } catch (error) {
    console.error("Post-login sync failed:", error);
    window.$message.warning("登录成功，但账号数据同步较慢，稍后会继续刷新");
  }

  emit("success");
  // 登录成功后静默热重载，让 UI 立即以登录状态刷新（跳过 beforeunload 拦截）
  (window as unknown as { __splayerHotReloading?: boolean }).__splayerHotReloading = true;
  setTimeout(() => window.location.reload(), 800);
};

const specialLogin = (type: "uid" | "cookie" = "uid") => {
  qrPause.value = true;
  const loginModal = window.$modal.create({
    title: type === "uid" ? "UID 登录" : "Cookie 登录",
    preset: "card",
    transformOrigin: "center",
    style: { width: "400px" },
    content: () => {
      return h(type === "uid" ? LoginUID : LoginCookie, {
        onClose: () => loginModal.destroy(),
        onSaveLogin: saveLogin,
      });
    },
    onClose: () => {
      qrPause.value = false;
      loginModal.destroy();
    },
  });
};

onBeforeMount(() => {
  if (dataStore.userLoginStatus && !props.force) {
    window.$message.warning("已登录，请勿重复操作");
    emit("close");
  }
});
</script>

<style lang="scss" scoped>
.login {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  .logo {
    width: 60px;
    height: 60px;
    margin: 20px auto 30px auto;
  }
  .other {
    margin: 20px 0;
    .n-button {
      width: 140px;
    }
  }
  .close {
    margin-bottom: 8px;
  }
}
</style>
