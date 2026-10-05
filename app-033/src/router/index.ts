import { createRouter, createWebHistory } from 'vue-router'

// history 路由对应规格书 §6 页面结构；nginx.conf 配 SPA 回退保证深链可访问
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('@/views/RaceListView.vue') },
    { path: '/race/:id', name: 'race', component: () => import('@/views/RaceSettingsView.vue') },
    { path: '/lofts', name: 'lofts', component: () => import('@/views/LoftsView.vue') },
    { path: '/entries/:id', name: 'entries', component: () => import('@/views/EntriesView.vue') },
    { path: '/results/:id', name: 'results', component: () => import('@/views/ResultsView.vue') },
    { path: '/versions/:id', name: 'versions', component: () => import('@/views/VersionsView.vue') },
    { path: '/export/:id', name: 'export', component: () => import('@/views/ExportView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
})
