import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// 纯前端构建：无外部网络依赖，所有资源本地打包
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 8113,
    host: true
  },
  build: {
    target: 'es2020',
    sourcemap: false
  }
})
