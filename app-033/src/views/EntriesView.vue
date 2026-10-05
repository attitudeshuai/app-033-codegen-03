<script setup lang="ts">
// 参赛与报到：报名录入 + 手工报到 + 批量导入（dry_run 两步）（规格书 §4.3 §8）
import { computed, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { store } from '@/composables/store'
import { previewReportImport, commitReportImport, type ImportPreview } from '@/composables/useReportImport'
import { formatShanghai, utcIsoToShanghaiInput } from '@/lib/time'
import { readFileAsText } from '@/lib/csv'
import type { Entry, ReportChannel } from '@/types'

const route = useRoute()
const race = computed(() => store.getRace(String(route.params.id)))

const entries = computed<Entry[]>(() =>
  race.value ? store.state.entries.filter((e) => e.raceId === race.value!.id) : []
)

const stats = computed(() => {
  const total = entries.value.length
  const reported = entries.value.filter((e) => e.reportAtUtc).length
  return { total, reported, missing: total - reported }
})

// ---------- 报名 ----------
const addForm = reactive({ loftId: '', ringNo: '', gender: '', color: '' })
const addErr = ref('')

function addPigeon(): void {
  addErr.value = ''
  if (!race.value) return
  if (!addForm.loftId) {
    addErr.value = '请选择鸽舍'
    return
  }
  if (!addForm.ringNo.trim()) {
    addErr.value = '请填写足环号'
    return
  }
  const ring = addForm.ringNo.trim()
  if (entries.value.some((e) => e.ringNo === ring)) {
    addErr.value = `足环号 ${ring} 在本赛事已报名`
    return
  }
  store.addEntry(race.value.id, addForm.loftId, ring, addForm.gender.trim() || undefined, addForm.color.trim() || undefined)
  addForm.ringNo = ''
  addForm.gender = ''
  addForm.color = ''
}

async function removePigeon(e: Entry): Promise<void> {
  if (!window.confirm(`确定删除参赛鸽 ${e.ringNo}？其报到记录将一并删除。`)) return
  await store.removeEntry(e.id)
}

// ---------- 手工报到（行内编辑） ----------
const drafts = new Map<string, { time: string; channel: ReportChannel }>()
function draftOf(e: Entry): { time: string; channel: ReportChannel } {
  let d = drafts.get(e.id)
  if (!d) {
    d = { time: e.reportAtUtc ? utcIsoToShanghaiInput(e.reportAtUtc) : '', channel: e.reportChannel }
    drafts.set(e.id, d)
  }
  return d
}

async function saveReport(e: Entry): Promise<void> {
  const d = draftOf(e)
  await store.setReport(e.id, d.time || null, d.channel)
}

// ---------- 批量导入 ----------
const importText = ref('')
const preview = ref<ImportPreview | null>(null)
const importMsg = ref('')
const importing = ref(false)

async function onFile(ev: Event): Promise<void> {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  importText.value = await readFileAsText(file)
  runPreview()
  ;(ev.target as HTMLInputElement).value = ''
}

function runPreview(): void {
  if (!race.value) return
  importMsg.value = ''
  try {
    preview.value = previewReportImport(race.value.id, importText.value)
  } catch (e) {
    preview.value = null
    importMsg.value = (e as Error).message
  }
}

async function doImport(): Promise<void> {
  if (!preview.value) return
  importing.value = true
  importMsg.value = ''
  try {
    await commitReportImport(preview.value)
    importMsg.value = `正式导入完成：新增 ${preview.value.createCount} 条、更新 ${preview.value.updateCount} 条，成绩已重算。`
    preview.value = null
    importText.value = ''
  } catch (e) {
    importMsg.value = (e as Error).message
  } finally {
    importing.value = false
  }
}

function loftName(id: string): string {
  return store.getLoft(id)?.name ?? '—'
}

const channelLabel: Record<ReportChannel, string> = {
  epad: '电子踏板',
  phone: '电话',
  clock: '鸽钟',
  manual: '手工'
}
</script>

<template>
  <div v-if="!race" class="page">
    <div class="notice danger">赛事不存在或已被删除。</div>
    <RouterLink to="/">← 返回赛事列表</RouterLink>
  </div>

  <div v-else class="page">
    <div class="page-head">
      <h1>参赛与报到 · {{ race.name }}</h1>
      <div class="row">
        <RouterLink class="btn ghost" :to="`/race/${race.id}`">← 设置</RouterLink>
        <RouterLink class="btn ghost" :to="`/results/${race.id}`">成绩 →</RouterLink>
      </div>
    </div>

    <div class="stat-grid" style="margin-bottom:16px">
      <div class="stat-box"><div class="v">{{ stats.total }}<span class="muted" style="font-size:13px"> / {{ race.expectedBirds || '—' }}</span></div><div class="l">已录入羽数/应参赛</div></div>
      <div class="stat-box"><div class="v">{{ stats.reported }}</div><div class="l">已报到</div></div>
      <div class="stat-box"><div class="v">{{ stats.missing }}</div><div class="l">未报到</div></div>
    </div>

    <!-- 新增参赛鸽 -->
    <div class="panel">
      <h2>新增参赛鸽</h2>
      <div class="grid-form">
        <label class="field">
          鸽舍
          <select v-model="addForm.loftId">
            <option value="" disabled>请选择鸽舍</option>
            <option v-for="l in store.state.lofts" :key="l.id" :value="l.id">{{ l.memberNo }} · {{ l.name }}</option>
          </select>
        </label>
        <label class="field">
          足环号
          <input v-model="addForm.ringNo" placeholder="如 CHN26-001001" />
        </label>
        <label class="field">
          性别（可选）
          <input v-model="addForm.gender" />
        </label>
        <label class="field">
          羽色（可选）
          <input v-model="addForm.color" />
        </label>
      </div>
      <div v-if="addErr" class="notice danger" style="margin-top:10px">{{ addErr }}</div>
      <div style="margin-top:10px">
        <button @click="addPigeon">报名</button>
      </div>
    </div>

    <!-- 批量导入 -->
    <div class="panel">
      <h2>批量导入报到数据</h2>
      <p class="muted">
        格式：足环号、报到时间（上海时间，如 2026-09-20 07:12:33）、报到方式（电子踏板/电话/鸽钟/手工，可空）。
        支持 Excel 另存的 CSV，或从 Excel 直接复制的制表符文本。导入前先 dry_run 预览，错误行会精确定位行号。
      </p>
      <div class="row" style="margin-bottom:10px">
        <label class="btn ghost small file-label">
          选择 CSV/TSV 文件
          <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden @change="onFile" />
        </label>
        <span class="muted">或直接粘贴到下方文本框</span>
      </div>
      <textarea v-model="importText" rows="6" placeholder="足环号,报到时间,报到方式&#10;CHN26-001001,2026-09-20 07:12:33,电子踏板"></textarea>
      <div class="row" style="margin-top:8px">
        <button class="ghost" @click="runPreview" :disabled="!importText.trim()">dry_run 预览</button>
      </div>

      <div v-if="preview" style="margin-top:12px">
        <div class="notice">
          预览结果：可导入 <b>{{ preview.items.length }}</b> 条（新增 {{ preview.createCount }}、更新 {{ preview.updateCount }}），
          错误 <b :class="{ 'error-text': preview.errors.length }">{{ preview.errors.length }}</b> 条。
        </div>
        <table v-if="preview.items.length" class="data" style="margin-top:8px">
          <thead>
            <tr><th class="num">行号</th><th>足环号</th><th>报到时间（上海）</th><th>方式</th><th>类型</th></tr>
          </thead>
          <tbody>
            <tr v-for="it in preview.items" :key="it.line">
              <td class="num">{{ it.line }}</td>
              <td>{{ it.ringNo }}</td>
              <td>{{ formatShanghai(it.reportUtc) }}</td>
              <td>{{ channelLabel[it.channel] }}</td>
              <td><span :class="['tag', it.isNew ? 'tag-ok' : 'tag-warn']">{{ it.isNew ? '新增报到' : '更新报到' }}</span></td>
            </tr>
          </tbody>
        </table>
        <table v-if="preview.errors.length" class="data" style="margin-top:10px">
          <thead>
            <tr><th class="num">行号</th><th>足环号</th><th>错误原因</th></tr>
          </thead>
          <tbody>
            <tr v-for="er in preview.errors" :key="er.line" class="danger-row">
              <td class="num bold">{{ er.line }}</td>
              <td>{{ er.ringNo }}</td>
              <td class="error-text bold">{{ er.reason }}</td>
            </tr>
          </tbody>
        </table>
        <div class="row" style="margin-top:10px">
          <button :disabled="!!preview.errors.length || importing" @click="doImport">
            {{ importing ? '导入中…' : '确认正式导入' }}
          </button>
          <span v-if="preview.errors.length" class="error-text">存在错误行，正式导入已禁用；请修正后重新预览。</span>
        </div>
      </div>
      <div v-if="importMsg" :class="['notice', importMsg.includes('完成') ? '' : 'danger']" style="margin-top:10px">{{ importMsg }}</div>
    </div>

    <!-- 参赛/报到清单 -->
    <div class="panel">
      <h2>参赛鸽与报到清单（{{ entries.length }} 羽）</h2>
      <table v-if="entries.length" class="data">
        <thead>
          <tr>
            <th>足环号</th>
            <th>鸽舍</th>
            <th>报到时间（上海，秒精度）</th>
            <th>报到方式</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in entries" :key="e.id">
            <td class="bold">{{ e.ringNo }}</td>
            <td>{{ loftName(e.loftId) }}</td>
            <td>
              <input type="datetime-local" step="1" v-model="draftOf(e).time" />
            </td>
            <td>
              <select v-model="draftOf(e).channel">
                <option value="epad">电子踏板</option>
                <option value="phone">电话</option>
                <option value="clock">鸽钟</option>
                <option value="manual">手工</option>
              </select>
            </td>
            <td>
              <div class="row">
                <button class="small ghost" @click="saveReport(e)">保存报到</button>
                <button class="small danger" @click="removePigeon(e)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="notice">尚未报名。先在上方手工添加，或录入鸽舍后统一登记。</div>
    </div>
  </div>
</template>

<style scoped>
.file-label {
  position: relative;
  cursor: pointer;
}
</style>
