<script setup lang="ts">
// 成绩单打印与上报导出（规格书 §4.5 §9 §10 /export/:id）：A4 张贴版 + CSV/Excel
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { store } from '@/composables/store'
import { formatShanghai, formatHms } from '@/lib/time'
import { toExcelCsv, downloadText } from '@/lib/csv'
import { stampForFile } from '@/lib/util'
import type { ResultRow } from '@/types'

const route = useRoute()
const race = computed(() => store.getRace(String(route.params.id)))
const rows = ref<ResultRow[]>([])

onMounted(async () => {
  if (!race.value) return
  const v = await store.ensureComputed(race.value.id)
  rows.value = v?.rows ?? store.liveRows(race.value)
})

const ranked = computed(() => rows.value.filter((r) => r.rank !== null))
const prizeRows = computed(() => rows.value.filter((r) => r.isPrize))

function doPrint(): void {
  window.print()
}

function exportAllCsv(): void {
  if (!race.value) return
  const data: (string | number)[][] = [
    [
      '名次', '会员号', '会员/鸽舍', '足环号', '空距(米)',
      '飞行时间', '分速(米/分)', '并列', '取奖', '异常标记'
    ],
    ...rows.value.map((r) => [
      r.rank ?? '',
      r.memberNo,
      r.loftName,
      r.ringNo,
      r.distanceM ?? '',
      formatHms(r.flightSeconds),
      r.speedMPerMin !== null ? r.speedMPerMin.toFixed(4) : '',
      r.isTie ? '并列' : '',
      r.isPrize ? '取奖' : '',
      r.flagged ?? ''
    ])
  ]
  downloadText(`成绩单-${race.value.name}-${stampForFile(Date.now())}.csv`, toExcelCsv(data))
}

function exportPrizeCsv(): void {
  if (!race.value) return
  const data: (string | number)[][] = [
    ['名次', '会员号', '会员/鸽舍', '足环号', '空距(米)', '分速(米/分)'],
    ...prizeRows.value.map((r) => [
      r.rank ?? '',
      r.memberNo,
      r.loftName,
      r.ringNo,
      r.distanceM ?? '',
      r.speedMPerMin !== null ? r.speedMPerMin.toFixed(4) : ''
    ])
  ]
  downloadText(`取奖名单-${race.value.name}-${stampForFile(Date.now())}.csv`, toExcelCsv(data))
}
</script>

<template>
  <div v-if="!race" class="page">
    <div class="notice danger">赛事不存在或已被删除。</div>
    <RouterLink to="/">← 返回赛事列表</RouterLink>
  </div>

  <div v-else class="page">
    <div class="page-head no-print">
      <h1>成绩单打印与上报 · {{ race.name }}</h1>
      <div class="row">
        <RouterLink class="btn ghost" :to="`/results/${race.id}`">← 成绩</RouterLink>
        <button class="ghost" @click="exportAllCsv">导出完整成绩单 CSV</button>
        <button class="ghost" @click="exportPrizeCsv">导出取奖名单 CSV</button>
        <button @click="doPrint">打印 / 打印预览（A4）</button>
      </div>
    </div>

    <div class="notice no-print">
      打印版为 A4 竖排，名次与分速加粗，字号适合张贴；打印内容与下方预览、成绩页数据一致。
      已报到但异常未处理的鸽子列在表后「待核实」区，不计名次。
    </div>

    <!-- A4 预览 -->
    <div class="a4-sheet">
      <div class="sheet-title">信鸽比赛成绩单</div>
      <table class="sheet-info">
        <tbody>
          <tr>
            <td class="lbl">赛事名称：</td><td class="val">{{ race.name }}</td>
            <td class="lbl">司放裁判：</td><td class="val">{{ race.judge }}</td>
          </tr>
          <tr>
            <td class="lbl">司放地点：</td>
            <td class="val">
              {{ race.releasePoint.lat.toFixed(6) }}, {{ race.releasePoint.lon.toFixed(6) }}
            </td>
            <td class="lbl">放飞时间：</td><td class="val">{{ formatShanghai(race.releaseAtUtc) }}</td>
          </tr>
          <tr>
            <td class="lbl">空距算法：</td>
            <td class="val">{{ race.distanceMethod === 'vincenty' ? 'Vincenty 椭球公式' : 'Haversine 球面公式' }}</td>
            <td class="lbl">参赛羽数：</td>
            <td class="val">{{ ranked.length }} 羽有效 / 共 {{ rows.length }} 羽（应到 {{ race.expectedBirds || '—' }}）</td>
          </tr>
        </tbody>
      </table>

      <table class="sheet-table">
        <thead>
          <tr>
            <th class="c-rank">名次</th>
            <th>会员号</th>
            <th>会员/鸽舍</th>
            <th>足环号</th>
            <th class="c-num">空距(米)</th>
            <th class="c-num">飞行时间</th>
            <th class="c-num">分速(米/分)</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in ranked" :key="r.entryId">
            <td class="c-rank rank-bold">{{ r.rank }}</td>
            <td>{{ r.memberNo }}</td>
            <td>{{ r.loftName }}</td>
            <td>{{ r.ringNo }}</td>
            <td class="c-num">{{ r.distanceM }}</td>
            <td class="c-num">{{ formatHms(r.flightSeconds) }}</td>
            <td class="c-num speed-bold">{{ r.speedMPerMin !== null ? r.speedMPerMin.toFixed(4) : '' }}</td>
            <td>
              <span v-if="r.isTie">并列</span>
              <span v-if="r.isPrize">取奖</span>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="rows.filter((r) => r.rank === null).length" class="pending-title">
        待核实 / 未计入成绩（共 {{ rows.filter((r) => r.rank === null).length }} 羽）
      </div>
      <table v-if="rows.filter((r) => r.rank === null).length" class="sheet-table">
        <thead>
          <tr>
            <th>足环号</th>
            <th>会员/鸽舍</th>
            <th class="c-num">空距(米)</th>
            <th>报到时间</th>
            <th>原因</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows.filter((x) => x.rank === null)" :key="r.entryId">
            <td>{{ r.ringNo }}</td>
            <td>{{ r.loftName }}</td>
            <td class="c-num">{{ r.distanceM ?? '—' }}</td>
            <td>{{ formatShanghai(r.reportAtUtc) }}</td>
            <td>{{ r.flagged === 'speed_too_high' ? '分速异常偏高·待人工确认' : r.flagged === 'before_release' ? '报到早于放飞' : r.flagged === 'missing_report' ? '未报到' : '—' }}</td>
          </tr>
        </tbody>
      </table>

      <div class="sign-row">
        <span>司放裁判签字：____________</span>
        <span>裁判长签字：____________</span>
        <span>日期：____________</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* A4 纸张：210mm；屏幕上以白底纸张样式预览 */
.a4-sheet {
  background: #fff;
  width: 210mm;
  min-height: 297mm;
  margin: 0 auto;
  padding: 14mm 13mm;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
  color: #000;
}
.sheet-title {
  text-align: center;
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 10px;
}
.sheet-info {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 10px;
  font-size: 12.5px;
}
.sheet-info td {
  padding: 3px 4px;
  vertical-align: top;
}
.sheet-info .lbl {
  white-space: nowrap;
  font-weight: 700;
  width: 72px;
}
.sheet-info .val {
  width: 26%;
}
.sheet-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.sheet-table th,
.sheet-table td {
  border: 1px solid #333;
  padding: 3px 5px;
  text-align: left;
}
.sheet-table th {
  background: #f0f0f0;
  font-weight: 700;
  text-align: center;
}
.c-rank {
  text-align: center;
  width: 44px;
}
.c-num {
  text-align: right;
  white-space: nowrap;
}
.rank-bold {
  font-weight: 700;
  font-size: 13px;
}
.speed-bold {
  font-weight: 700;
}
.pending-title {
  margin-top: 12px;
  font-weight: 700;
  font-size: 13px;
}
.sign-row {
  margin-top: 18px;
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}

@media screen and (max-width: 900px) {
  .a4-sheet {
    width: 100%;
    padding: 18px;
  }
}

@media print {
  .a4-sheet {
    width: auto;
    min-height: 0;
    margin: 0;
    padding: 0;
    box-shadow: none;
  }
}
</style>
