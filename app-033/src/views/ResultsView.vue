<script setup lang="ts">
// 成绩计算与排名（规格书 §4.4/4.5 §5 §9 /results/:id）：并列、异常、距离对照、团体赛
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { store } from '@/composables/store'
import { flagText, teamStandings } from '@/lib/calc'
import { formatHms, formatShanghai } from '@/lib/time'
import type { ResultRow } from '@/types'

const route = useRoute()
const race = computed(() => store.getRace(String(route.params.id)))
const rows = ref<ResultRow[]>([])
const versionNo = ref<number | null>(null)
const showCompare = ref(true)
const teamTopN = ref(3)

async function refresh(): Promise<void> {
  if (!race.value) return
  const v = await store.ensureComputed(race.value.id)
  rows.value = v?.rows ?? store.liveRows(race.value)
  versionNo.value = v?.version ?? null
}

onMounted(refresh)

async function manualRecalc(): Promise<void> {
  if (!race.value) return
  const v = await store.recalcRace(race.value.id, '裁判手动重算')
  if (!v) {
    // 无差异：刷新展示即可
    rows.value = store.liveRows(race.value)
  } else {
    await refresh()
  }
}

async function confirmRow(r: ResultRow): Promise<void> {
  await store.confirmEntry(r.entryId)
  await refresh()
}
async function unconfirmRow(r: ResultRow): Promise<void> {
  await store.unconfirmEntry(r.entryId)
  await refresh()
}

const teams = computed(() => teamStandings(rows.value, teamTopN.value))

const otherMethodName = computed(() =>
  race.value?.distanceMethod === 'vincenty' ? 'Haversine' : 'Vincenty'
)
</script>

<template>
  <div v-if="!race" class="page">
    <div class="notice danger">赛事不存在或已被删除。</div>
    <RouterLink to="/">← 返回赛事列表</RouterLink>
  </div>

  <div v-else class="page">
    <div class="page-head">
      <h1>成绩计算与排名 · {{ race.name }}</h1>
      <div class="row">
        <RouterLink class="btn ghost" :to="`/entries/${race.id}`">← 参赛报到</RouterLink>
        <RouterLink class="btn ghost" :to="`/versions/${race.id}`">版本历史</RouterLink>
        <RouterLink class="btn ghost" :to="`/export/${race.id}`">导出 →</RouterLink>
        <button class="ghost" @click="manualRecalc">重新计算</button>
      </div>
    </div>

    <div class="notice">
      当前成绩版本：<b>第 {{ versionNo ?? '—' }} 版</b>
      ｜空距算法：{{ race.distanceMethod === 'vincenty' ? 'Vincenty（WGS-84 椭球）' : 'Haversine（球面）' }}
      ｜并列规则：{{ race.tieRule === 'same_rank_skip' ? '同名次跳号' : '顺序编号（按入舍顺序）' }}
      ｜并列口径：分速保留 4 位小数后相等
    </div>

    <div class="panel">
      <label class="row" style="gap:8px; margin-bottom:10px">
        <input type="checkbox" style="width:auto" v-model="showCompare" />
        <span>显示 {{ otherMethodName }} 对照距离（差异 &gt; 0.05% 高亮提示核查坐标）</span>
      </label>

      <table class="data">
        <thead>
          <tr>
            <th class="num">名次</th>
            <th>会员 / 鸽舍</th>
            <th>足环号</th>
            <th class="num">空距(米)</th>
            <th v-if="showCompare" class="num">{{ otherMethodName }}(米)</th>
            <th v-if="showCompare" class="num">差异</th>
            <th class="num">飞行时间</th>
            <th class="num">分速(米/分)</th>
            <th>状态/操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in rows"
            :key="r.entryId"
            :class="{
              'flagged-row': r.flagged === 'speed_too_high',
              'danger-row': r.flagged === 'before_release' || r.flagged === 'missing_report'
            }"
          >
            <td class="num">
              <span class="rank-cell bold">{{ r.rank ?? '—' }}</span>
              <span v-if="r.isTie" class="tag tag-tie" style="margin-left:4px">并列</span>
              <span v-if="r.isPrize" class="tag tag-prize" style="margin-left:4px">取奖</span>
            </td>
            <td>
              <div class="bold">{{ r.loftName }}</div>
              <div class="muted" style="font-size:12px">{{ r.memberNo }}</div>
            </td>
            <td>{{ r.ringNo }}</td>
            <td class="num">{{ r.distanceM ?? '—' }}</td>
            <template v-if="showCompare">
              <td class="num">{{ r.otherDistanceM ?? '—' }}</td>
              <td class="num">
                <span v-if="r.distanceDiffPct !== null" :class="{ 'diff-warn': r.distanceDiffPct > 0.05 }">
                  {{ r.distanceDiffPct.toFixed(4) }}%
                </span>
              </td>
            </template>
            <td class="num">{{ formatHms(r.flightSeconds) }}</td>
            <td class="num bold speed-cell">{{ r.speedMPerMin !== null ? r.speedMPerMin.toFixed(4) : '—' }}</td>
            <td>
              <div v-if="r.flagged" class="flag-box">
                <span class="flag-icon">⚠</span>
                <span class="flag-text bold">{{ flagText(r.flagged) }}</span>
              </div>
              <div v-if="r.flagged === 'speed_too_high'" class="flag-actions">
                <button v-if="!r.confirmed" class="small" @click="confirmRow(r)">裁判确认计入</button>
              </div>
              <div v-if="r.confirmed && !r.flagged" class="flag-box">
                <span class="tag tag-ok">已人工确认</span>
                <button class="small ghost" style="margin-left:6px" @click="unconfirmRow(r)">撤销</button>
              </div>
              <div v-if="r.flagged === 'before_release'" class="muted" style="font-size:12px">
                报到时刻：{{ formatShanghai(r.reportAtUtc) }}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 团体赛（进阶功能 §5） -->
    <div class="panel">
      <div class="row" style="justify-content:space-between">
        <h2 style="margin:0">团体赛成绩（同一会员取前 N 羽分速合计）</h2>
        <label class="row" style="gap:6px">
          每舍取前
          <input type="number" min="1" max="20" v-model.number="teamTopN" style="width:70px" />
          羽
        </label>
      </div>
      <table class="data" style="margin-top:10px">
        <thead>
          <tr>
            <th class="num">团体名次</th>
            <th>会员 / 鸽舍</th>
            <th class="num">计奖羽数</th>
            <th class="num">分速合计(米/分)</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in teams" :key="t.loftId">
            <td class="num bold">{{ t.rank }}<span v-if="t.isTie" class="tag tag-tie" style="margin-left:4px">并列</span></td>
            <td>{{ t.memberNo }} · {{ t.loftName }}</td>
            <td class="num">{{ t.counted }}</td>
            <td class="num bold">{{ t.speedSum.toFixed(4) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.rank-cell {
  font-size: 15px;
}
.speed-cell {
  font-size: 14.5px;
}
.diff-warn {
  color: var(--c-danger);
  font-weight: 700;
}
.flag-box {
  display: flex;
  align-items: center;
  gap: 6px;
}
.flag-icon {
  font-size: 16px;
}
.flag-actions {
  margin-top: 5px;
}
.flag-text {
  white-space: nowrap;
}
</style>
