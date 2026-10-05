<script setup lang="ts">
// 应用外壳：顶部导航 + 当前操作人（留痕用）
import { ref } from 'vue'
import { RouterLink, RouterView } from 'vue-router'
import { store } from '@/composables/store'

const opInput = ref(store.operator.value)

async function saveOp(): Promise<void> {
  await store.setOperator(opInput.value)
}
</script>

<template>
  <header class="app-header">
    <div class="app-header-inner">
      <RouterLink to="/" class="brand">
        <span class="brand-mark">🕊</span>
        <span class="brand-text">信鸽竞翔分速与成绩计算</span>
      </RouterLink>
      <nav class="app-nav">
        <RouterLink to="/">赛事列表</RouterLink>
        <RouterLink to="/lofts">会员与鸽舍</RouterLink>
      </nav>
      <div class="op-box">
        <span class="op-label">操作人：</span>
        <input v-model="opInput" class="op-input" @change="saveOp" placeholder="裁判姓名" />
      </div>
    </div>
  </header>
  <RouterView />
</template>

<style scoped>
.app-header {
  background: #163a72;
  color: #fff;
}
.app-header-inner {
  max-width: 1180px;
  margin: 0 auto;
  padding: 10px 22px;
  display: flex;
  align-items: center;
  gap: 22px;
  flex-wrap: wrap;
}
.brand {
  color: #fff;
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  font-size: 16px;
}
.brand:hover {
  text-decoration: none;
}
.brand-mark {
  font-size: 20px;
}
.app-nav {
  display: flex;
  gap: 14px;
}
.app-nav a {
  color: #d9e6fb;
  font-size: 14px;
}
.app-nav a.router-link-exact-active {
  color: #fff;
  font-weight: 700;
}
.op-box {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
}
.op-label {
  font-size: 13px;
  color: #c9d8f0;
}
.op-input {
  width: 130px;
  padding: 4px 8px;
  font-size: 13px;
}
</style>
