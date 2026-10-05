// 全局数据中心：Vue reactive 状态 + IndexedDB 持久化 + 重算/版本留痕（规格书 §4.6 §8）
import { reactive, ref, computed } from 'vue'
import type {
  Race,
  Loft,
  Entry,
  ResultVersion,
  Confirmation,
  RaceGroup,
  ResultRow,
  BackupFile
} from '@/types'
import {
  idbGetAll,
  idbPut,
  idbBulkPut,
  idbDelete,
  idbClearAll,
  idbGetMeta,
  idbSetMeta
} from '@/db/db'
import { calcResults, buildChanges, resultsDiffer, latestVersion, type InputEdit } from '@/lib/calc'
import { uid, round4 } from '@/lib/util'
import { shanghaiInputToUtcIso } from '@/lib/time'

interface State {
  races: Race[]
  lofts: Loft[]
  entries: Entry[]
  versions: ResultVersion[]
  confirmations: Confirmation[]
  groups: RaceGroup[]
}

const state = reactive<State>({
  races: [],
  lofts: [],
  entries: [],
  versions: [],
  confirmations: [],
  groups: []
})

const loaded = ref(false)
const operator = ref('司放裁判')

// 距上次成绩版本之后累积的输入改动（按赛事）
const pendingEdits = new Map<string, InputEdit[]>()

function pushEdits(raceId: string, edits: InputEdit[]): void {
  if (edits.length === 0) return
  const arr = pendingEdits.get(raceId) ?? []
  arr.push(...edits)
  pendingEdits.set(raceId, arr)
}

export const store = {
  state,
  loaded,
  operator,

  async init(): Promise<void> {
    if (loaded.value) return
    const [races, lofts, entries, versions, confirmations, groups, op] = await Promise.all([
      idbGetAll<Race>('races'),
      idbGetAll<Loft>('lofts'),
      idbGetAll<Entry>('entries'),
      idbGetAll<ResultVersion>('versions'),
      idbGetAll<Confirmation>('confirmations'),
      idbGetAll<RaceGroup>('groups'),
      idbGetMeta<string>('operator')
    ])
    state.races.push(...races)
    state.lofts.push(...lofts)
    state.entries.push(...entries)
    state.versions.push(...versions)
    state.confirmations.push(...confirmations)
    state.groups.push(...groups)
    if (op) operator.value = op
    loaded.value = true
  },

  async setOperator(name: string): Promise<void> {
    const v = name.trim() || '司放裁判'
    operator.value = v
    await idbSetMeta('operator', v)
  },

  // ---------- 赛事 ----------
  async upsertRace(input: Race): Promise<void> {
    const idx = state.races.findIndex((r) => r.id === input.id)
    if (idx === -1) {
      state.races.push(input)
      await idbPut('races', input)
      return
    }
    const old = state.races[idx]
    const edits = diffRace(old, input)
    state.races.splice(idx, 1, input)
    await idbPut('races', input)
    if (edits.length) {
      pushEdits(input.id, edits)
      await this.recalcRace(input.id)
    }
  },

  getRace(id: string): Race | undefined {
    return state.races.find((r) => r.id === id)
  },

  async removeRace(id: string): Promise<void> {
    state.races = state.races.filter((r) => r.id !== id)
    state.entries = state.entries.filter((e) => e.raceId !== id)
    state.versions = state.versions.filter((v) => v.raceId !== id)
    state.confirmations = state.confirmations.filter((c) => c.raceId !== id)
    state.groups.forEach((g) => {
      g.raceIds = g.raceIds.filter((r) => r !== id)
    })
    pendingEdits.delete(id)
    await Promise.all([
      idbBulkPut('races', state.races),
      idbBulkPut('entries', state.entries),
      idbBulkPut('versions', state.versions),
      idbBulkPut('confirmations', state.confirmations),
      idbBulkPut('groups', state.groups)
    ])
  },

  // ---------- 鸽舍 ----------
  async upsertLoft(input: Loft): Promise<void> {
    const idx = state.lofts.findIndex((l) => l.id === input.id)
    let oldLoft: Loft | null = null
    if (idx === -1) {
      state.lofts.push(input)
    } else {
      oldLoft = state.lofts[idx]
      state.lofts.splice(idx, 1, input)
    }
    await idbPut('lofts', input)
    if (oldLoft && (oldLoft.geo.lat !== input.geo.lat || oldLoft.geo.lon !== input.geo.lon)) {
      // 鸽舍坐标影响所有赛事
      for (const race of state.races) {
        const hasEntries = state.entries.some((e) => e.raceId === race.id)
        if (!hasEntries) continue
        pushEdits(race.id, [
          {
            field: `鸽舍坐标（${input.name}）`,
            from: `${round4(oldLoft.geo.lat)}, ${round4(oldLoft.geo.lon)}`,
            to: `${round4(input.geo.lat)}, ${round4(input.geo.lon)}`
          }
        ])
        await this.recalcRace(race.id)
      }
    }
  },

  getLoft(id: string): Loft | undefined {
    return state.lofts.find((l) => l.id === id)
  },

  async removeLoft(id: string): Promise<void> {
    state.lofts = state.lofts.filter((l) => l.id !== id)
    await idbDelete('lofts', id)
  },

  // ---------- 参赛 / 报到 ----------
  addEntry(raceId: string, loftId: string, ringNo: string, gender?: string, color?: string): Entry {
    const e: Entry = { id: uid('ent'), raceId, loftId, ringNo, reportChannel: 'manual', gender, color }
    state.entries.push(e)
    void idbPut('entries', e)
    return e
  },

  async removeEntry(id: string): Promise<void> {
    const e = state.entries.find((x) => x.id === id)
    state.entries = state.entries.filter((x) => x.id !== id)
    state.confirmations = state.confirmations.filter((c) => c.entryId !== id)
    await Promise.all([idbDelete('entries', id), idbBulkPut('confirmations', state.confirmations)])
    if (e) {
      pushEdits(e.raceId, [{ field: '删除参赛鸽', from: e.ringNo, to: null, entryId: id, ringNo: e.ringNo }])
      await this.recalcRace(e.raceId)
    }
  },

  async setReport(
    entryId: string,
    reportLocal: string | null,
    channel: Entry['reportChannel']
  ): Promise<void> {
    const e = state.entries.find((x) => x.id === entryId)
    if (!e) return
    const oldIso = e.reportAtUtc
    const newIso = reportLocal ? shanghaiInputToUtcIso(reportLocal) : undefined
    const edit: InputEdit = {
      field: '报到时间',
      from: oldIso ?? null,
      to: newIso ?? null,
      entryId: e.id,
      ringNo: e.ringNo
    }
    e.reportAtUtc = newIso
    e.reportChannel = channel
    await idbPut('entries', e)
    pushEdits(e.raceId, [edit])
    await this.recalcRace(e.raceId)
  },

  // ---------- 人工确认（异常分速，留痕） ----------
  async confirmEntry(entryId: string): Promise<void> {
    const e = state.entries.find((x) => x.id === entryId)
    if (!e) return
    const race = this.getRace(e.raceId)
    if (!race) return
    const rows = this.liveRows(race)
    const speed = rows.find((r) => r.entryId === entryId)?.speedMPerMin ?? 0
    const c: Confirmation = {
      id: uid('cfm'),
      raceId: e.raceId,
      entryId,
      ringNo: e.ringNo,
      by: operator.value,
      at: Date.now(),
      speedMPerMin: speed
    }
    state.confirmations.push(c)
    await idbPut('confirmations', c)
    pushEdits(e.raceId, [
      { field: '裁判人工确认异常分速', from: '待核实', to: '已确认计入名次', entryId, ringNo: e.ringNo }
    ])
    await this.recalcRace(e.raceId)
  },

  async unconfirmEntry(entryId: string): Promise<void> {
    const e = state.entries.find((x) => x.id === entryId)
    if (!e) return
    state.confirmations = state.confirmations.filter((c) => c.entryId !== entryId)
    await idbBulkPut('confirmations', state.confirmations)
    pushEdits(e.raceId, [
      { field: '撤销异常分速确认', from: '已确认', to: '待核实', entryId, ringNo: e.ringNo }
    ])
    await this.recalcRace(e.raceId)
  },

  isConfirmed(raceId: string, entryId: string): boolean {
    return state.confirmations.some((c) => c.raceId === raceId && c.entryId === entryId)
  },

  // ---------- 多关赛 ----------
  async upsertGroup(g: RaceGroup): Promise<void> {
    const idx = state.groups.findIndex((x) => x.id === g.id)
    if (idx === -1) state.groups.push(g)
    else state.groups.splice(idx, 1, g)
    await idbPut('groups', g)
  },

  async removeGroup(id: string): Promise<void> {
    state.groups = state.groups.filter((g) => g.id !== id)
    await idbDelete('groups', id)
  },

  // ---------- 成绩重算 / 版本 ----------
  confirmedSet(raceId: string): Set<string> {
    return new Set(state.confirmations.filter((c) => c.raceId === raceId).map((c) => c.entryId))
  },

  loftMap(): Map<string, Loft> {
    return new Map(state.lofts.map((l) => [l.id, l]))
  },

  liveRows(race: Race): ResultRow[] {
    const entries = state.entries.filter((e) => e.raceId === race.id)
    return calcResults(race, this.loftMap(), entries, this.confirmedSet(race.id))
  },

  /**
   * 重算并在需要时生成新版本。
   * 规则：影响成绩的改动必须产生新版本；旧版本不可删除。
   */
  async recalcRace(raceId: string, note?: string, extraEdits: InputEdit[] = []): Promise<ResultVersion | null> {
    const race = this.getRace(raceId)
    if (!race) return null
    const rows = this.liveRows(race)
    const prev = latestVersion(state.versions, raceId)
    const edits = [...(pendingEdits.get(raceId) ?? []), ...extraEdits]

    let shouldCreate = false
    if (!prev) {
      if (state.entries.some((e) => e.raceId === raceId)) shouldCreate = true
    } else if (resultsDiffer(prev.rows, rows) || edits.length > 0 || note) {
      shouldCreate = true
    }
    if (!shouldCreate) {
      pendingEdits.delete(raceId)
      return null
    }

    const version: ResultVersion = {
      id: uid('ver'),
      raceId,
      version: prev ? prev.version + 1 : 1,
      method: race.distanceMethod,
      tieRule: race.tieRule,
      releaseAtUtc: race.releaseAtUtc,
      rows,
      computedAt: Date.now(),
      changes: prev ? buildChanges(prev.rows, rows, edits) : [],
      by: operator.value,
      note
    }
    state.versions.push(version)
    await idbPut('versions', version)
    pendingEdits.delete(raceId)
    return version
  },

  /** 页面进入时：若无版本或数据已变化则补算 */
  async ensureComputed(raceId: string): Promise<ResultVersion | null> {
    const race = this.getRace(raceId)
    if (!race) return null
    const prev = latestVersion(state.versions, raceId)
    if (!prev) return this.recalcRace(raceId)
    const rows = this.liveRows(race)
    if (resultsDiffer(prev.rows, rows)) return this.recalcRace(raceId)
    return prev
  },

  versionsOf(raceId: string): ResultVersion[] {
    return state.versions.filter((v) => v.raceId === raceId).sort((a, b) => a.version - b.version)
  },

  // ---------- 备份 ----------
  buildBackup(): BackupFile {
    return {
      app: 'pigeon-race-calculator',
      exportedAt: Date.now(),
      by: operator.value,
      races: JSON.parse(JSON.stringify(state.races)),
      lofts: JSON.parse(JSON.stringify(state.lofts)),
      entries: JSON.parse(JSON.stringify(state.entries)),
      versions: JSON.parse(JSON.stringify(state.versions)),
      confirmations: JSON.parse(JSON.stringify(state.confirmations)),
      groups: JSON.parse(JSON.stringify(state.groups))
    }
  },

  async restoreBackup(data: BackupFile): Promise<void> {
    if (data.app !== 'pigeon-race-calculator') throw new Error('不是本应用的备份文件')
    state.races = data.races ?? []
    state.lofts = data.lofts ?? []
    state.entries = data.entries ?? []
    state.versions = data.versions ?? []
    state.confirmations = data.confirmations ?? []
    state.groups = data.groups ?? []
    await idbClearAll()
    await Promise.all([
      idbBulkPut('races', state.races),
      idbBulkPut('lofts', state.lofts),
      idbBulkPut('entries', state.entries),
      idbBulkPut('versions', state.versions),
      idbBulkPut('confirmations', state.confirmations),
      idbBulkPut('groups', state.groups)
    ])
  }
}

function diffRace(oldRace: Race, newRace: Race): InputEdit[] {
  const edits: InputEdit[] = []
  const add = (field: string, from: unknown, to: unknown): void => {
    if (from !== to) edits.push({ field, from, to })
  }
  add('放飞时间（UTC）', oldRace.releaseAtUtc, newRace.releaseAtUtc)
  add('司放点纬度', oldRace.releasePoint.lat, newRace.releasePoint.lat)
  add('司放点经度', oldRace.releasePoint.lon, newRace.releasePoint.lon)
  add('距离算法', oldRace.distanceMethod, newRace.distanceMethod)
  add('并列规则', oldRace.tieRule, newRace.tieRule)
  add('异常分速上限', oldRace.abnormalSpeedMm, newRace.abnormalSpeedMm)
  add('取奖名次数', oldRace.prizeRanks, newRace.prizeRanks)
  return edits
}

// ---------- 供视图用的派生状态 ----------
export function entriesOf(raceId: string): Entry[] {
  return store.state.entries.filter((e) => e.raceId === raceId)
}

export function useRaceMeta(raceId: string) {
  return computed(() => {
    const list = entriesOf(raceId)
    const reported = list.filter((e) => e.reportAtUtc).length
    return { total: list.length, reported, missing: list.length - reported }
  })
}
