<template>
  <div class="streaming-server-config">
    <n-form
      ref="formRef"
      :model="serverForm"
      :rules="formRules"
      label-placement="left"
      label-width="auto"
      require-mark-placement="right-hanging"
    >
      <n-form-item label="服务类型" path="type">
        <n-select
          v-model:value="serverForm.type"
          :options="serverTypeOptions"
          placeholder="选择服务类型"
        />
      </n-form-item>
      <n-form-item label="服务器名称" path="name">
        <n-input v-model:value="serverForm.name" placeholder="为服务器取个名字（如：我的音乐库）" />
      </n-form-item>
      <n-form-item label="服务器地址" path="url">
        <n-input v-model:value="serverForm.url" :placeholder="urlPlaceholder" />
      </n-form-item>

      <!-- WebDAV 专用：库根目录 -->
      <n-form-item v-if="isWebDav" label="库根目录" path="libraryRoot">
        <n-input
          v-model:value="serverForm.libraryRoot"
          placeholder="留空或填 /，可指定子目录如 /Music"
        />
      </n-form-item>

      <!-- WebDAV 专用：认证方式 -->
      <n-form-item v-if="isWebDav" label="认证方式" path="webdavAuth">
        <n-select
          v-model:value="serverForm.webdavAuth"
          :options="webdavAuthOptions"
          placeholder="选择认证方式"
        />
      </n-form-item>

      <n-form-item v-if="needAuth" label="用户名" :path="usernamePath">
        <n-input v-model:value="serverForm.username" placeholder="输入用户名" />
      </n-form-item>
      <n-form-item v-if="needAuth" label="密码" :path="passwordPath">
        <n-input
          v-model:value="serverForm.password"
          type="password"
          show-password-on="click"
          placeholder="输入密码"
        />
      </n-form-item>

      <n-alert
        v-if="isWebDav && serverForm.webdavAuth === 'digest'"
        type="warning"
        :show-icon="true"
      >
        Digest Auth 当前不支持。建议改用 Basic Auth；如果服务器强制 Digest，请先在服务器侧切换。
      </n-alert>
      <n-alert v-if="isWebDav" type="info" :show-icon="true" style="margin-top: 8px">
        WebDAV 是文件协议，初次连接需扫描整个库以聚合艺术家/专辑，库较大时请耐心等待。
      </n-alert>
    </n-form>
    <n-flex justify="end" style="margin-top: 12px">
      <n-button @click="handleCancel">取消</n-button>
      <n-button type="primary" :loading="loading" @click="handleSave">
        {{ isEditing ? "保存" : "添加" }}
      </n-button>
    </n-flex>
  </div>
</template>

<script setup lang="ts">
import type { StreamingServerConfig, StreamingServerType, WebDavAuthType } from "@/types/streaming";
import type { FormInst, FormRules } from "naive-ui";

const props = defineProps<{
  server?: StreamingServerConfig | null;
}>();

const emit = defineEmits<{
  /** 保存成功 */
  save: [config: Omit<StreamingServerConfig, "id">];
  /** 取消 */
  cancel: [];
}>();

const loading = ref<boolean>(false);
const formRef = ref<FormInst | null>(null);
// 是否为编辑
const isEditing = computed(() => !!props.server);

// 服务器表单
const serverForm = reactive({
  type: "navidrome" as StreamingServerType,
  name: "",
  url: "",
  username: "",
  password: "",
  libraryRoot: "/",
  webdavAuth: "basic" as WebDavAuthType,
});

// 是否为 WebDAV
const isWebDav = computed(() => serverForm.type === "webdav");
// WebDAV 匿名访问时不需要用户名/密码
const needAuth = computed(() => {
  if (!isWebDav.value) return true;
  return serverForm.webdavAuth !== "anonymous";
});

// URL 占位提示
const urlPlaceholder = computed(() => {
  if (isWebDav.value) return "https://example.com/dav 或 https://nas.lan/remote.php/webdav";
  return "http://127.0.0.1:4533";
});

// 服务器类型选项
const serverTypeOptions = [
  { label: "Navidrome", value: "navidrome" },
  { label: "Jellyfin", value: "jellyfin" },
  { label: "Emby", value: "emby" },
  { label: "Subsonic", value: "subsonic" },
  { label: "OpenSubsonic", value: "opensubsonic" },
  { label: "WebDAV", value: "webdav" },
];

// WebDAV 认证方式选项
const webdavAuthOptions = [
  { label: "Basic Auth（推荐）", value: "basic" },
  { label: "Digest Auth（暂不支持）", value: "digest", disabled: true },
  { label: "匿名访问", value: "anonymous" },
];

// 验证规则中 username/password 的 path —— 匿名时跳过校验
const usernamePath = computed(() => (needAuth.value ? "username" : undefined));
const passwordPath = computed(() => (needAuth.value ? "password" : undefined));

// 表单验证规则
const formRules = computed<FormRules>(() => {
  const rules: FormRules = {
    type: { required: true, message: "请选择服务类型", trigger: "change" },
    name: { required: true, message: "请输入服务器名称", trigger: "blur" },
    url: { required: true, message: "请输入服务器地址", trigger: "blur" },
  };
  if (needAuth.value) {
    rules.username = { required: true, message: "请输入用户名", trigger: "blur" };
    rules.password = { required: true, message: "请输入密码", trigger: "blur" };
  }
  if (isWebDav.value) {
    rules.webdavAuth = { required: true, message: "请选择认证方式", trigger: "change" };
  }
  return rules;
});

// 用服务器数据填充表单
const fillForm = (server: StreamingServerConfig) => {
  serverForm.type = server.type;
  serverForm.name = server.name;
  serverForm.url = server.url;
  serverForm.username = server.username;
  serverForm.password = server.password;
  serverForm.libraryRoot = server.libraryRoot || "/";
  serverForm.webdavAuth = server.webdavAuth || "basic";
};

// 保存
const handleSave = async () => {
  try {
    await formRef.value?.validate();
    loading.value = true;

    const payload: Omit<StreamingServerConfig, "id"> = {
      type: serverForm.type,
      name: serverForm.name,
      url: serverForm.url,
      username: needAuth.value ? serverForm.username : "",
      password: needAuth.value ? serverForm.password : "",
    };
    if (isWebDav.value) {
      payload.libraryRoot = serverForm.libraryRoot || "/";
      payload.webdavAuth = serverForm.webdavAuth;
    }
    emit("save", payload);
  } catch {
    // 验证失败
  } finally {
    loading.value = false;
  }
};

// 取消
const handleCancel = () => emit("cancel");

// 监听服务器变化
watch(
  () => props.server,
  (server) => {
    if (server) {
      fillForm(server);
    }
  },
  { immediate: true },
);
</script>
