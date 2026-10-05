<script setup lang="ts">
// 会员与鸽舍坐标（规格书 §4.2 / §6 /lofts）
import { computed, reactive, ref } from 'vue'
import { store } from '@/composables/store'
import GeoInput from '@/components/GeoInput.vue'
import { formatDmsHemi } from '@/lib/geo'
import { uid } from '@/lib/util'
import type { Loft } from '@/types'

const editingId = ref<string | null>(null) // null=未在编辑；'new'=新增
const form = reactive({
  memberNo: '',
  name: '',
  geo: { lat: 31.2, lon: 121.4 },
  phone: ''
})
const errMsg = ref('')

const lofts = computed(() => store.state.lofts)

function usageCount(id: string): number {
  return store.state.entries.filter((e) => e.loftId === id).length
}

function startNew(): void {
  editingId.value = 'new'
  form.memberNo = ''
  form.name = ''
  form.geo = { lat: 31.2, lon: 121.4 }
  form.phone = ''
  errMsg.value = ''
}

function startEdit(l: Loft): void {
  editingId.value = l.id
  form.memberNo = l.memberNo
  form.name = l.name
  form.geo = { lat: l.geo.lat, lon: l.geo.lon }
  form.phone = l.phone ?? ''
  errMsg.value = ''
}

function cancel(): void {
  editingId.value = null
}

async function save(): Promise<void> {
  errMsg.value = ''
  if (!form.memberNo.trim()) {
    errMsg.value = '请填写会员号'
    return
  }
  if (!form.name.trim()) {
    errMsg.value = '请填写姓名/鸽舍名'
    return
  }
  const dup = store.state.lofts.find(
    (l) => l.memberNo === form.memberNo.trim() && l.id !== editingId.value
  )
  if (dup) {
    errMsg.value = `会员号已存在（${dup.name}）`
    return
  }
  const loft: Loft = {
    id: editingId.value === 'new' ? uid('loft') : editingId.value!,
    memberNo: form.memberNo.trim(),
    name: form.name.trim(),
    geo: { ...form.geo },
    phone: form.phone.trim() || undefined
  }
  await store.upsertLoft(loft)
  editingId.value = null
}

async function remove(l: Loft): Promise<void> {
  const used = usageCount(l.id)
  if (used > 0) {
    window.alert(`该鸽舍已有 ${used} 条参赛记录，不能删除。请先在相应赛事中删除参赛鸽。`)
    return
  }
  if (!window.confirm(`确定删除鸽舍「${l.name}」？`)) return
  await store.removeLoft(l.id)
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>会员与鸽舍坐标</h1>
      <button v-if="editingId === null" @click="startNew">＋ 新增会员/鸽舍</button>
    </div>

    <div v-if="editingId !== null" class="panel">
      <h2>{{ editingId === 'new' ? '新增会员/鸽舍' : '编辑鸽舍' }}</h2>
      <div class="grid-form">
        <label class="field">
          会员号
          <input v-model="form.memberNo" />
        </label>
        <label class="field">
          姓名 / 鸽舍名
          <input v-model="form.name" />
        </label>
        <label class="field">
          联系方式
          <input v-model="form.phone" />
        </label>
      </div>
      <div style="margin-top:12px">
        <GeoInput v-model="form.geo" />
      </div>
      <div v-if="errMsg" class="notice danger" style="margin-top:12px">{{ errMsg }}</div>
      <div class="row" style="margin-top:12px">
        <button @click="save">保存</button>
        <button class="ghost" @click="cancel">取消</button>
      </div>
    </div>

    <div class="panel">
      <table v-if="lofts.length" class="data">
        <thead>
          <tr>
            <th>会员号</th>
            <th>姓名/鸽舍名</th>
            <th>纬度</th>
            <th>经度</th>
            <th>联系方式</th>
            <th class="num">参赛记录</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in lofts" :key="l.id">
            <td class="bold">{{ l.memberNo }}</td>
            <td>{{ l.name }}</td>
            <td>{{ formatDmsHemi(l.geo.lat, 'lat', 1) }}</td>
            <td>{{ formatDmsHemi(l.geo.lon, 'lon', 1) }}</td>
            <td>{{ l.phone || '—' }}</td>
            <td class="num">{{ usageCount(l.id) }}</td>
            <td>
              <div class="row">
                <button class="small ghost" :disabled="editingId !== null" @click="startEdit(l)">编辑</button>
                <button class="small danger" :disabled="editingId !== null" @click="remove(l)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="notice">还没有鸽舍。点击「新增会员/鸽舍」开始录入。</div>
    </div>
  </div>
</template>
