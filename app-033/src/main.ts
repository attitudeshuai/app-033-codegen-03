import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { store } from './composables/store'
import './styles.css'

store.init().finally(() => {
  createApp(App).use(router).mount('#app')
})
