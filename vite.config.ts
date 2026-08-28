import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { resolve } from "path";
import AutoImport from "unplugin-auto-import/vite";
import { NaiveUiResolver } from "unplugin-vue-components/resolvers";
import Components from "unplugin-vue-components/vite";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  base: "./",
  publicDir: resolve(__dirname, "public"),
  plugins: [
    vue(),
    AutoImport({
      imports: [
        "vue",
        "vue-router",
        "@vueuse/core",
        {
          "naive-ui": ["useDialog", "useMessage", "useNotification", "useLoadingBar"],
        },
      ],
      eslintrc: {
        enabled: true,
        filepath: "./auto-eslint.mjs",
      },
    }),
    Components({
      resolvers: [NaiveUiResolver()],
    }),
    wasm(),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/"),
      "@emi": resolve(__dirname, "native/external-media-integration"),
      "@shared": resolve(__dirname, "src/types/shared"),
      "@opencc": resolve(__dirname, "native/ferrous-opencc-wasm/pkg"),
      "@native": resolve(__dirname, "native"),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        silenceDeprecations: ["legacy-js-api"],
      },
    },
  },
  build: {
    outDir: "dist/capacitor",
    sourcemap: false,
    minify: "terser",
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
      },
      external: ["external-media-integration.node"],
      output: {
        manualChunks: {
          stores: ["src/stores/data.ts", "src/stores/index.ts"],
          // 核心框架独立分包，减少首屏解析量并提升缓存复用
          vue: ["vue", "vue-router", "pinia", "@vueuse/core"],
          "naive-ui": ["naive-ui"],
          axios: ["axios", "axios-retry"],
        },
      },
    },
    terserOptions: {
      compress: {
        pure_funcs: ["console.log"],
      },
    },
  },
});
