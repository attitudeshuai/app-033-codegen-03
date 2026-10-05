<script setup lang="ts">
// 赛事设置（规格书 §4.1 / §6 /race/:id / §9）
import { computed, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { store } from '@/composables/store'
import GeoInput from '@/components/GeoInput.vue'
import { utcIsoToShanghaiInput, shanghaiInputToUtcIso } from '@/lib/time'
import type { Race } from '@/types'

const route = useRoute()
const race = computed(() => store.getRace(String(route.params.id)))
const saved = ref(false)

const draft = reactive({
  name: race.value?.name ?? '',
  releaseLocal: race.value ? utcIsoToShanghaiInput(race.value.releaseAtUtc) : '',
  releasePoint: race.value
    ? { lat: race.value.releasePoint.lat, lon: race.value.releasePoint.lon }
    : { lat: 0, lon: 0 },
  judge: race.value?.judge ?? '',
  expectedBirds: race.value?.expectedBirds ?? 0,
  prizeRanks: race.value?.prizeRanks ?? 10,
  distanceMethod: race.value?.distanceMethod ?? 'vincenty',
  tieRule: race.value?.tieRule ?? 'same_rank_skip',
  abnormalSpeedMm: race.value?.abnormalSpeedMm ?? 2000
})

const meta = computed(() => {
  if (!race.value) return { total: 0, reported: 0 }
  const list = store.state.entries.filter((e) => e.raceId === race.value!.id)
  return { total: list.length, reported: list.filter((e) => e.reportAtUtc).length }
})

const missingList = computed(() => {
  if (!race.value) return []
  return store.state.entries
    .filter((e) => e.raceId === race.value!.id && !e.reportAtUtc)
    .map((e) => {
      const loft = store.getLoft(e.loftId)
      return { ringNo: e.ringNo, loft: loft?.name ?? '—' }
    })
})

const errMsg = ref('')

async function onSave(): Promise<void> {
  errMsg.value = ''
  if (!race.value) return
  if (!draft.name.trim()) {
    errMsg.value = '请填写赛事名称'
    return
  }
  let releaseAtUtc = race.value.releaseAtUtc
  if (draft.releaseLocal) {
    try {
      releaseAtUtc = shanghaiInputToUtcIso(draft.releaseLocal)
    } catch (e) {
      errMsg.value = (e as Error).message
      return
    }
  }
  const updated: Race = {
    ...race.value,
    name: draft.name.trim(),
    releasePoint: { ...draft.releasePoint },
    releaseAtUtc,
    judge: draft.judge.trim(),
    expectedBirds: Number(draft.expectedBirds) || 0,
    prizeRanks: Number(draft.prizeRanks) || 0,
    distanceMethod: draft.distanceMethod,
    tieRule: draft.tieRule,
    abnormalSpeedMm: Number(draft.abnormalSpeedMm) || 2000
  }
  await store.upsertRace(updated)
  saved.value = true
  setTimeout(() => (saved.value = false), 2000)
}
</script>

<template>
  <div v-if="!race" class="page">
    <div class="notice danger">赛事不存在或已被删除。</div>
    <RouterLink to="/">← 返回赛事列表</RouterLink>
  </div>

  <div v-else class="page">
    <div class="page-head">
      <h1>赛事设置 · {{ race.name }}</h1>
      <div class="row">
        <RouterLink class="btn ghost" :to="`/entries/${race.id}`">参赛报到 →</RouterLink>
        <RouterLink class="btn ghost" :to="`/results/${race.id}`">成绩 →</RouterLink>
      </div>
    </div>

    <div class="stat-grid" style="margin-bottom:16px">
      <div class="stat-box">
        <div class="v">{{ meta.total }} <span class="muted" style="font-size:14px">/ {{ meta.reported }} 已报到</span></div>
        <div class="l">已录入羽数（含报到情况）</div>
      </div>
      <div class="stat-box">
        <div class="v">{{ race.expectedBirds || '—' }}</div>
        <div class="l">应参赛羽数</div>
      </div>
      <div class="stat-box">
        <div class="v">{{ race.prizeRanks }}</div>
        <div class="l">名次取奖数</div>
      </div>
      <div class="stat-box">
        <div class="v">{{ missingList.length }}</div>
        <div class="l">未报到羽数</div>
      </div>
    </div>

    <div class="panel">
      <h2>基本信息</h2>
      <div class="grid-form">
        <label class="field span2">
          赛事名称
          <input v-model="draft.name" />
        </label>
        <label class="field">
          放飞时间（上海时间，精确到秒）
          <input v-model="draft.releaseLocal" type="datetime-local" step="1" />
          <span class="muted hint">内部统一以 UTC 存储，跨天/时区不影响飞行时间</span>
        </label>
        <label class="field">
          司放裁判
          <input v-model="draft.judge" />
        </label>
        <label class="field">
          参赛羽数（应到）
          <input v-model.number="draft.expectedBirds" type="number" min="0" />
        </label>
        <label class="field">
          名次取奖数
          <input v-model.number="draft.prizeRanks" type="number" min="0" />
        </label>
      </div>
    </div>

    <div class="panel">
      <h2>司放点坐标</h2>
      <GeoInput v-model="draft.releasePoint" />
    </div>

    <div class="panel">
      <h2>成绩规则</h2>
      <div class="grid-form">
        <label class="field">
          空距算法（默认 Vincenty 椭球）
          <select v-model="draft.distanceMethod">
            <option value="vincenty">Vincenty（WGS-84 椭球，推荐）</option>
            <option value="haversine">Haversine（球面近似，可对照）</option>
          </select>
        </label>
        <label class="field">
          并列处理规则
          <select v-model="draft.tieRule">
            <option value="same_rank_skip">同名次跳号（1, 2, 2, 4）</option>
            <option value="sequential">顺序编号（1, 2, 3, 4，并列按入舍顺序）</option>
          </select>
          <span class="muted hint">并列判定口径：分速保留 4 位小数后相等即并列</span>
        </label>
        <label class="field">
          异常分速上限（米/分）
          <input v-model.number="draft.abnormalSpeedMm" type="number" min="1" />
          <span class="muted hint">超过上限只标记为待核实，不自动计成绩</span>
        </label>
      </div>
    </div>

    <div v-if="missingList.length" class="panel">
      <h2>未报到清单（{{ missingList.length }} 羽）</h2>
      <div class="missing-chips">
        <span v-for="m in missingList" :key="m.ringNo" class="missing-chip">
          {{ m.ringNo }} · {{ m.loft }}
        </span>
      </div>
    </div>

    <div v-if="errMsg" class="notice danger">{{ errMsg }}</div>
    <div v-if="saved" class="notice">已保存；影响成绩的改动已触发重算并生成新版本，可在「版本」中查看。</div>

    <div class="row">
      <button @click="onSave">保存设置</button>
      <RouterLink class="btn ghost" to="/">返回列表</RouterLink>
    </div>
  </div>
</template>

<style scoped>
.span2 {
  grid-column: span 2;
}
.hint {
  font-size: 12px;
}
.missing-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.missing-chip {
  border: 1px solid var(--c-border);
  border-radius: 999px;
  padding: 3px 12px;
  font-size: 13px;
  background: #fafbfe;
}
</style>
