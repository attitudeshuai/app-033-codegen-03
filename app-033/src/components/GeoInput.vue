<script setup lang="ts">
// 坐标录入：度分秒 ↔ 十进制度 双向互转（规格书 §4.1/4.2 §8），两种模式实时同步
import { ref, watch } from 'vue'
import type { Geo } from '@/types'
import { parseDms, formatDmsHemi, validateGeo } from '@/lib/geo'

const props = defineProps<{ modelValue: Geo }>()
const emit = defineEmits<{ 'update:modelValue': [Geo] }>()

const mode = ref<'dec' | 'dms'>('dec')
const decLat = ref(String(props.modelValue.lat))
const decLon = ref(String(props.modelValue.lon))
const dmsLat = ref(formatDmsHemi(props.modelValue.lat, 'lat', 2))
const dmsLon = ref(formatDmsHemi(props.modelValue.lon, 'lon', 2))
const latErr = ref('')
const lonErr = ref('')

// 外部值变化 → 同步四個输入框
watch(
  () => props.modelValue,
  (g: Geo) => {
    decLat.value = String(g.lat)
    decLon.value = String(g.lon)
    dmsLat.value = formatDmsHemi(g.lat, 'lat', 2)
    dmsLon.value = formatDmsHemi(g.lon, 'lon', 2)
    latErr.value = ''
    lonErr.value = ''
  }
)

function tryEmit(lat: number, lon: number): void {
  const err = validateGeo({ lat, lon })
  if (!err) emit('update:modelValue', { lat, lon })
}

// 十进制度输入
function onDecLat(): void {
  const v = Number(decLat.value)
  if (!Number.isFinite(v) || Math.abs(v) > 90) {
    latErr.value = '纬度必须是 -90 ~ 90 的数字'
    return
  }
  latErr.value = ''
  dmsLat.value = formatDmsHemi(v, 'lat', 2)
  tryEmit(v, Number(decLon.value))
}
function onDecLon(): void {
  const v = Number(decLon.value)
  if (!Number.isFinite(v) || Math.abs(v) > 180) {
    lonErr.value = '经度必须是 -180 ~ 180 的数字'
    return
  }
  lonErr.value = ''
  dmsLon.value = formatDmsHemi(v, 'lon', 2)
  tryEmit(Number(decLat.value), v)
}

// 度分秒输入
function onDmsLat(): void {
  try {
    const v = parseDms(dmsLat.value)
    if (Math.abs(v) > 90) throw new Error('纬度必须在 -90 ~ 90 之间')
    latErr.value = ''
    decLat.value = String(v)
    tryEmit(v, Number(decLon.value))
  } catch (e) {
    latErr.value = (e as Error).message
  }
}
function onDmsLon(): void {
  try {
    const v = parseDms(dmsLon.value)
    if (Math.abs(v) > 180) throw new Error('经度必须在 -180 ~ 180 之间')
    lonErr.value = ''
    decLon.value = String(v)
    tryEmit(Number(decLat.value), v)
  } catch (e) {
    lonErr.value = (e as Error).message
  }
}
</script>

<template>
  <div class="geo-input">
    <div class="mode-switch">
      <button type="button" class="small" :class="mode === 'dec' ? '' : 'ghost'" @click="mode = 'dec'">
        十进制度
      </button>
      <button type="button" class="small" :class="mode === 'dms' ? '' : 'ghost'" @click="mode = 'dms'">
        度分秒
      </button>
    </div>

    <div v-if="mode === 'dec'" class="geo-fields">
      <label class="field">
        纬度（十进制度，南纬为负）
        <input v-model="decLat" :class="{ invalid: !!latErr }" @input="onDecLat" />
        <span v-if="latErr" class="error-text">{{ latErr }}</span>
      </label>
      <label class="field">
        经度（十进制度，西经为负）
        <input v-model="decLon" :class="{ invalid: !!lonErr }" @input="onDecLon" />
        <span v-if="lonErr" class="error-text">{{ lonErr }}</span>
      </label>
    </div>

    <div v-else class="geo-fields">
      <label class="field">
        纬度（如 31°12′36″ N）
        <input v-model="dmsLat" :class="{ invalid: !!latErr }" @input="onDmsLat" />
        <span v-if="latErr" class="error-text">{{ latErr }}</span>
        <span v-else class="muted hint">= {{ decLat }}°</span>
      </label>
      <label class="field">
        经度（如 121°25′48″ E）
        <input v-model="dmsLon" :class="{ invalid: !!lonErr }" @input="onDmsLon" />
        <span v-if="lonErr" class="error-text">{{ lonErr }}</span>
        <span v-else class="muted hint">= {{ decLon }}°</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
.geo-input {
  border: 1px dashed var(--c-border);
  border-radius: 6px;
  padding: 10px 12px;
}
.mode-switch {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}
.geo-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.hint {
  font-size: 12px;
}
</style>
