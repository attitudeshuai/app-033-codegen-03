<script setup lang="ts">
// 赛事列表（规格书 §6 /）：新建赛事、示例数据、备份导入导出、多关赛管理
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { store } from '@/composables/store'
import { loadSampleRace } from '@/composables/useSample'
import { groupStandings } from '@/lib/calc'
import { formatShanghai, shanghaiInputToUtcIso } from '@/lib/time'
import { downloadText, readFileAsText } from '@/lib/csv'
import { uid, stampForFile } from '@/lib/util'
import { idbPut } from '@/db/db'
import type { Race, RaceGroup, GroupMode } from '@/types'

const router = useRouter()
const loading = ref(false)
const msg = ref('')

const races = computed(() => store.state.races)

function entryCount(raceId: string): number {
  return store.state.entries.filter((e) => e.raceId === raceId).length
}
function versionCount(raceId: string): number {
  return store.state.versions.filter((v) => v.raceId === raceId).length
}

function defaultReleaseLocal(): string {
  const d = new Date(Date.now() + 24 * 3600_000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T06:30:00`
}

async function createRace(): Promise<void> {
  const race: Race = {
    id: uid('race'),
    name: `未命名赛事 ${races.value.length + 1}`,
    releasePoint: { lat: 31 + 10 / 60, lon: 121 + 15 / 60 },
    releaseAtUtc: shanghaiInputToUtcIso(defaultReleaseLocal()),
    judge: store.operator.value,
    expectedBirds: 0,
    prizeRanks: 10,
    distanceMethod: 'vincenty',
    tieRule: 'same_rank_skip',
    abnormalSpeedMm: 2000,
    createdAt: Date.now()
  }
  store.state.races.push(race)
  await idbPut('races', race)
  router.push(`/race/${race.id}`)
}

async function loadSample(): Promise<void> {
  loading.value = true
  msg.value = ''
  try {
    const id = await loadSampleRace()
    router.push(`/results/${id}`)
  } catch (e) {
    msg.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

async function removeRace(id: string): Promise<void> {
  if (!window.confirm('确定删除该赛事？其参赛、报到与成绩版本将一并删除，且不可恢复。')) return
  await store.removeRace(id)
}

// ---------- 备份 ----------
function exportBackup(): void {
  const data = store.buildBackup()
  downloadText(
    `pigeon-backup-${stampForFile(Date.now())}.json`,
    JSON.stringify(data, null, 2),
    'application/json;charset=utf-8'
  )
}

async function onBackupFile(e: Event): Promise<void> {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const text = await readFileAsText(file)
    const data = JSON.parse(text)
    if (!window.confirm('恢复备份将覆盖当前全部数据，确定继续？')) return
    await store.restoreBackup(data)
    msg.value = '备份已恢复'
  } catch (err) {
    msg.value = `恢复失败：${(err as Error).message}`
  }
  ;(e.target as HTMLInputElement).value = ''
}

// ---------- 多关赛 ----------
const newGroupName = ref('')
const newGroupMode = ref<GroupMode>('avg')
const selectedRaces = ref<string[]>([])

function toggleRace(id: string, ev: Event): void {
  const checked = (ev.target as HTMLInputElement).checked
  if (checked) selectedRaces.value.push(id)
  else selectedRaces.value = selectedRaces.value.filter((r) => r !== id)
}

async function createGroup(): Promise<void> {
  if (!newGroupName.value.trim() || selectedRaces.value.length < 2) {
    msg.value = '多关赛至少需要名称和两场赛事'
    return
  }
  const g: RaceGroup = {
    id: uid('grp'),
    name: newGroupName.value.trim(),
    raceIds: [...selectedRaces.value],
    mode: newGroupMode.value,
    weights: Object.fromEntries(selectedRaces.value.map((id) => [id, 1])),
    createdAt: Date.now()
  }
  await store.upsertGroup(g)
  newGroupName.value = ''
  selectedRaces.value = []
}

const expandedGroup = ref<string | null>(null)
function groupStanding(g: RaceGroup) {
  const map = new Map(
    g.raceIds.map((rid) => {
      const race = store.getRace(rid)
      return [rid, race ? store.liveRows(race) : []]
    })
  )
  return groupStandings(g, map)
}
function raceName(id: string): string {
  return store.getRace(id)?.name ?? '（已删除）'
}
async function removeGroup(id: string): Promise<void> {
  await store.removeGroup(id)
  if (expandedGroup.value === id) expandedGroup.value = null
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>赛事列表</h1>
      <div class="row">
        <button @click="createRace">＋ 新建赛事</button>
        <button class="ghost" :disabled="loading" @click="loadSample">载入示例赛事（虚构数据）</button>
        <button class="ghost" @click="exportBackup">导出备份文件</button>
        <label class="btn ghost file-btn">
          恢复备份
          <input type="file" accept=".json,application/json" hidden @change="onBackupFile" />
        </label>
      </div>
    </div>

    <div v-if="msg" class="notice warn">{{ msg }}</div>

    <div class="panel">
      <table v-if="races.length" class="data">
        <thead>
          <tr>
            <th>赛事名称</th>
            <th>放飞时间（上海）</th>
            <th>司放裁判</th>
            <th class="num">已报名</th>
            <th class="num">成绩版本</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in races" :key="r.id">
            <td class="bold">{{ r.name }}</td>
            <td>{{ formatShanghai(r.releaseAtUtc) }}</td>
            <td>{{ r.judge }}</td>
            <td class="num">{{ entryCount(r.id) }}<span class="muted"> / {{ r.expectedBirds || '—' }}</span></td>
            <td class="num">{{ versionCount(r.id) }}</td>
            <td>
              <div class="row action-links">
                <RouterLink :to="`/race/${r.id}`">设置</RouterLink>
                <RouterLink :to="`/entries/${r.id}`">参赛报到</RouterLink>
                <RouterLink :to="`/results/${r.id}`">成绩</RouterLink>
                <RouterLink :to="`/versions/${r.id}`">版本</RouterLink>
                <RouterLink :to="`/export/${r.id}`">导出</RouterLink>
                <button class="small danger" @click="removeRace(r.id)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="notice">
        还没有赛事。点击「新建赛事」开始，或「载入示例赛事」快速体验完整流程（示例会员与成绩均为虚构）。
      </div>
    </div>

    <!-- 多关赛（进阶功能 §5） -->
    <div class="panel">
      <h2>多关赛</h2>
      <p class="muted">同一批信鸽参加多场比赛，按关累加/平均/加权分速综合排名；须在每一关都有有效成绩的鸽才计入。</p>
      <div class="grid-form" v-if="races.length >= 2">
        <label class="field">
          多关赛名称
          <input v-model="newGroupName" placeholder="如：2026 秋季三关赛" />
        </label>
        <label class="field">
          综合规则
          <select v-model="newGroupMode">
            <option value="sum">分速累加</option>
            <option value="avg">分速平均</option>
            <option value="weighted">按权重加权平均</option>
          </select>
        </label>
      </div>
      <div v-if="races.length >= 2" class="race-pick">
        <label v-for="r in races" :key="r.id" class="pick-item">
          <input type="checkbox" :checked="selectedRaces.includes(r.id)" @change="toggleRace(r.id, $event)" />
          <span>{{ r.name }}</span>
        </label>
      </div>
      <div v-if="races.length >= 2" style="margin-top: 10px">
        <button @click="createGroup">创建多关赛</button>
      </div>

      <div v-for="g in store.state.groups" :key="g.id" class="group-block">
        <div class="group-head">
          <span class="bold">{{ g.name }}</span>
          <span class="muted">
            （{{ { sum: '累加', avg: '平均', weighted: '加权平均' }[g.mode] }}；
            {{ g.raceIds.map(raceName).join(' → ') }}）
          </span>
          <span class="row" style="margin-left:auto">
            <button class="small ghost" @click="expandedGroup = expandedGroup === g.id ? null : g.id">
              {{ expandedGroup === g.id ? '收起' : '查看综合排名' }}
            </button>
            <button class="small danger" @click="removeGroup(g.id)">删除</button>
          </span>
        </div>
        <table v-if="expandedGroup === g.id" class="data" style="margin-top:8px">
          <thead>
            <tr>
              <th class="num">综合名次</th>
              <th>足环号</th>
              <th>鸽舍</th>
              <th v-for="rid in g.raceIds" :key="rid" class="num">{{ raceName(rid) }}</th>
              <th class="num">综合分速</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in groupStanding(g)" :key="row.ringNo">
              <td class="num bold">{{ row.rank }}<span v-if="row.isTie" class="tag tag-tie" style="margin-left:4px">并列</span></td>
              <td>{{ row.ringNo }}</td>
              <td>{{ row.loftName }}</td>
              <td v-for="rid in g.raceIds" :key="rid" class="num">{{ row.speeds[rid] ?? '—' }}</td>
              <td class="num bold">{{ row.aggregate.toFixed(4) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-btn {
  position: relative;
  cursor: pointer;
}
.action-links {
  gap: 10px;
}
.race-pick {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  margin-top: 10px;
}
.pick-item {
  display: flex;
  gap: 5px;
  align-items: center;
  font-size: 13.5px;
}
.pick-item input {
  width: auto;
}
.group-block {
  border-top: 1px solid var(--c-border);
  padding: 10px 0;
}
.group-head {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
</style>
