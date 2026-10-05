<script setup lang="ts">
// 成绩版本历史与改动对比（规格书 §4.6 §9 /versions/:id）。旧版本不可删除，页面不提供删除入口。
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { store } from '@/composables/store'
import { formatShanghai } from '@/lib/time'
import { toExcelCsv, downloadText } from '@/lib/csv'
import type { ResultVersion, ResultRow } from '@/types'

const route = useRoute()
const race = computed(() => store.getRace(String(route.params.id)))

const versions = computed<ResultVersion[]>(() => (race.value ? store.versionsOf(race.value.id) : []))

const leftVersion = ref<number>(0)
const rightVersion = ref<number>(0)

watch(
  versions,
  (list: ResultVersion[]) => {
    if (list.length && leftVersion.value === 0) {
      rightVersion.value = list[list.length - 1].version
      leftVersion.value = list.length > 1 ? list[list.length - 2].version : list[0].version
    }
  },
  { immediate: true }
)

const left = computed(() => versions.value.find((v) => v.version === leftVersion.value))
const right = computed(() => versions.value.find((v) => v.version === rightVersion.value))

interface CmpRow {
  ringNo: string
  loftName: string
  oldRank: number | null
  newRank: number | null
  oldSpeed: number | null
  newSpeed: number | null
  oldFlag: string | null
  newFlag: string | null
  arrow: 'up' | 'down' | 'same' | 'in' | 'out' | 'none'
}

function flagOf(r: ResultRow | undefined): string | null {
  return r?.flagged ?? null
}

const compareRows = computed<CmpRow[]>(() => {
  if (!left.value || !right.value) return []
  const lm = new Map(left.value.rows.map((r) => [r.entryId, r]))
  const rm = new Map(right.value.rows.map((r) => [r.entryId, r]))
  const ids = new Set<string>([...lm.keys(), ...rm.keys()])
  const out: CmpRow[] = []
  for (const id of ids) {
    const a = lm.get(id)
    const b = rm.get(id)
    let arrow: CmpRow['arrow'] = 'none'
    if (a && b) {
      if (a.rank === b.rank) arrow = 'same'
      else if (a.rank === null && b.rank !== null) arrow = 'in'
      else if (a.rank !== null && b.rank === null) arrow = 'out'
      else arrow = (a.rank ?? 0) > (b.rank ?? 0) ? 'up' : 'down'
    }
    out.push({
      ringNo: b?.ringNo ?? a?.ringNo ?? '',
      loftName: b?.loftName ?? a?.loftName ?? '',
      oldRank: a?.rank ?? null,
      newRank: b?.rank ?? null,
      oldSpeed: a?.speedMPerMin ?? null,
      newSpeed: b?.speedMPerMin ?? null,
      oldFlag: flagOf(a),
      newFlag: flagOf(b),
      arrow
    })
  }
  // 按新名次、旧名次排序
  out.sort((x, y) => {
    const rx = x.newRank ?? 9999
    const ry = y.newRank ?? 9999
    if (rx !== ry) return rx - ry
    return (x.oldRank ?? 9999) - (y.oldRank ?? 9999)
  })
  return out
})

function arrowSymbol(a: CmpRow['arrow']): string {
  return { up: '↑', down: '↓', same: '＝', in: '⤓', out: '⤒', none: '' }[a]
}

function exportChangeNote(): void {
  if (!right.value || !race.value) return
  const v = right.value
  const rows: (string | number)[][] = [
    ['成绩变更说明'],
    ['赛事名称', race.value.name],
    ['版本', `第 ${v.version} 版`],
    ['生成时间', formatShanghai(new Date(v.computedAt).toISOString())],
    ['操作人', v.by],
    ['放飞时间(上海)', formatShanghai(v.releaseAtUtc)],
    v.note ? ['备注', v.note] : [],
    [],
    ['改动字段', '改前', '改后', '名次变化(正=上升)', '足环号'],
    ...v.changes.map((c) => [
      c.field,
      c.from === null || c.from === undefined ? '' : String(c.from),
      c.to === null || c.to === undefined ? '' : String(c.to),
      c.diffRanks,
      c.ringNo ?? ''
    ])
  ]
  downloadText(`成绩变更说明-${race.value.name}-第${v.version}版.csv`, toExcelCsv(rows))
}
</script>

<template>
  <div v-if="!race" class="page">
    <div class="notice danger">赛事不存在或已被删除。</div>
    <RouterLink to="/">← 返回赛事列表</RouterLink>
  </div>

  <div v-else class="page">
    <div class="page-head">
      <h1>成绩版本历史 · {{ race.name }}</h1>
      <div class="row">
        <RouterLink class="btn ghost" :to="`/results/${race.id}`">← 成绩</RouterLink>
        <RouterLink class="btn ghost" :to="`/export/${race.id}`">导出 →</RouterLink>
      </div>
    </div>

    <div class="notice">
      任何影响成绩的字段变更（放飞时间、司放/鸽舍坐标、报到时间、人工确认）都会生成新版本；
      <b>旧版本永久保留、不可删除</b>。
    </div>

    <div class="panel">
      <h2>版本清单（{{ versions.length }} 个）</h2>
      <table v-if="versions.length" class="data">
        <thead>
          <tr>
            <th class="num">版本</th>
            <th>计算时间（上海）</th>
            <th>操作人</th>
            <th>放飞时间（上海）</th>
            <th class="num">改动条目</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="v in versions" :key="v.id">
            <td class="num bold">第 {{ v.version }} 版</td>
            <td>{{ formatShanghai(new Date(v.computedAt).toISOString()) }}</td>
            <td>{{ v.by }}</td>
            <td>{{ formatShanghai(v.releaseAtUtc) }}</td>
            <td class="num">{{ v.changes.length }}</td>
            <td>{{ v.note || '—' }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else class="notice warn">尚无成绩版本，请先在「成绩」页计算。</div>
    </div>

    <div v-if="versions.length" class="panel">
      <h2>版本对比（旧名次 → 新名次）</h2>
      <div class="row" style="margin-bottom:10px">
        <label class="row" style="gap:6px">
          旧版
          <select v-model.number="leftVersion" style="width:120px">
            <option v-for="v in versions" :key="v.id" :value="v.version">第 {{ v.version }} 版</option>
          </select>
        </label>
        <span>→</span>
        <label class="row" style="gap:6px">
          新版
          <select v-model.number="rightVersion" style="width:120px">
            <option v-for="v in versions" :key="v.id" :value="v.version">第 {{ v.version }} 版</option>
          </select>
        </label>
        <button class="ghost" @click="exportChangeNote">导出成绩变更说明（公示用）</button>
      </div>

      <table class="data">
        <thead>
          <tr>
            <th>足环号 / 鸽舍</th>
            <th class="num">旧名次</th>
            <th></th>
            <th class="num">新名次</th>
            <th class="num">旧分速</th>
            <th class="num">新分速</th>
            <th>旧状态</th>
            <th>新状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in compareRows" :key="r.ringNo">
            <td>
              <div class="bold">{{ r.ringNo }}</div>
              <div class="muted" style="font-size:12px">{{ r.loftName }}</div>
            </td>
            <td class="num bold">{{ r.oldRank ?? '—' }}</td>
            <td class="num">
              <span :class="{ 'arr-up': r.arrow === 'up' || r.arrow === 'in', 'arr-down': r.arrow === 'down' || r.arrow === 'out' }">
                {{ arrowSymbol(r.arrow) }}
              </span>
            </td>
            <td class="num bold">{{ r.newRank ?? '—' }}</td>
            <td class="num">{{ r.oldSpeed !== null ? r.oldSpeed.toFixed(4) : '—' }}</td>
            <td class="num">{{ r.newSpeed !== null ? r.newSpeed.toFixed(4) : '—' }}</td>
            <td>{{ r.oldFlag ?? '—' }}</td>
            <td>{{ r.newFlag ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="versions.length" class="panel">
      <h2>最新版改动留痕</h2>
      <table class="data">
        <thead>
          <tr>
            <th>改动字段</th>
            <th>改前</th>
            <th>改后</th>
            <th class="num">名次变化</th>
            <th>足环号</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(c, i) in versions[versions.length - 1].changes" :key="i">
            <td class="bold">{{ c.field }}</td>
            <td>{{ c.from === null || c.from === undefined ? '—' : c.from }}</td>
            <td>{{ c.to === null || c.to === undefined ? '—' : c.to }}</td>
            <td class="num bold">
              <span :class="c.diffRanks > 0 ? 'arr-up' : c.diffRanks < 0 ? 'arr-down' : ''">
                {{ c.diffRanks > 0 ? `↑${c.diffRanks}` : c.diffRanks < 0 ? `↓${Math.abs(c.diffRanks)}` : '0' }}
              </span>
            </td>
            <td>{{ c.ringNo ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.arr-up {
  color: var(--c-ok);
  font-weight: 700;
  font-size: 15px;
}
.arr-down {
  color: var(--c-danger);
  font-weight: 700;
  font-size: 15px;
}
</style>
