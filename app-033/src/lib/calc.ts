// 成绩计算核心（规格书 §8）：分速、并列排名、异常标记、版本差异、多关赛、团体赛
import type {
  Race,
  Loft,
  Entry,
  ResultRow,
  ChangeRecord,
  FlagKind,
  RaceGroup,
  ResultVersion
} from '@/types'
import { distanceM } from './geo'
import { round4 } from './util'

export interface InputEdit {
  field: string
  from: unknown
  to: unknown
  entryId?: string
  ringNo?: string
}

interface CalcCache {
  main: Map<string, number>
  other: Map<string, number>
}

/**
 * 计算整场赛事成绩。
 * confirmedIds：已被裁判人工确认的异常快鸽子 id 集合。
 * 距离按 loftId 缓存，避免 5000 羽重复算同一鸽舍。
 */
export function calcResults(
  race: Race,
  loftMap: Map<string, Loft>,
  entries: Entry[],
  confirmedIds: ReadonlySet<string>,
  cache?: CalcCache
): ResultRow[] {
  const c: CalcCache = cache ?? { main: new Map(), other: new Map() }
  const otherMethod = race.distanceMethod === 'vincenty' ? 'haversine' : 'vincenty'

  const built: ResultRow[] = entries.map((e) => {
    const loft = loftMap.get(e.loftId)
    const row: ResultRow = {
      rank: null,
      entryId: e.id,
      loftId: e.loftId,
      loftName: loft?.name ?? '（鸽舍不存在）',
      memberNo: loft?.memberNo ?? '',
      ringNo: e.ringNo,
      distanceM: null,
      otherDistanceM: null,
      distanceDiffPct: null,
      flightSeconds: null,
      speedMPerMin: null,
      isTie: false,
      isPrize: false,
      flagged: null,
      confirmed: confirmedIds.has(e.id),
      reportAtUtc: e.reportAtUtc
    }

    if (!loft) return row

    let d = c.main.get(e.loftId)
    if (d === undefined) {
      d = distanceM(race.releasePoint, loft.geo, race.distanceMethod)
      c.main.set(e.loftId, d)
    }
    let dOther = c.other.get(e.loftId)
    if (dOther === undefined) {
      dOther = distanceM(race.releasePoint, loft.geo, otherMethod)
      c.other.set(e.loftId, dOther)
    }
    row.distanceM = d
    row.otherDistanceM = dOther
    row.distanceDiffPct = d === 0 ? 0 : (Math.abs(d - dOther) / d) * 100

    if (!e.reportAtUtc) {
      row.flagged = 'missing_report'
      return row
    }

    const releaseMs = new Date(race.releaseAtUtc).getTime()
    const reportMs = new Date(e.reportAtUtc).getTime()
    const flightSec = (reportMs - releaseMs) / 1000
    row.flightSeconds = flightSec

    if (flightSec < 0) {
      row.flagged = 'before_release'
      return row
    }
    if (flightSec === 0) {
      // 报到与放飞同时刻：不可能完成飞行
      row.flagged = 'speed_too_high'
      return row
    }

    const speed = round4(d / (flightSec / 60))
    row.speedMPerMin = speed

    if (speed > race.abnormalSpeedMm) {
      if (!confirmedIds.has(e.id)) {
        row.flagged = 'speed_too_high'
        row.speedMPerMin = speed // 保留数值供裁判查看，但不参与排名
      }
    }
    return row
  })

  // 排名：只有 flagged === null 的行参与
  const eligible = built.filter((r) => r.flagged === null)
  eligible.sort((a, b) => {
    if ((b.speedMPerMin ?? 0) !== (a.speedMPerMin ?? 0)) {
      return (b.speedMPerMin ?? 0) - (a.speedMPerMin ?? 0)
    }
    // 并列时按入舍（报到）先后
    const ta = a.reportAtUtc ? new Date(a.reportAtUtc).getTime() : Number.POSITIVE_INFINITY
    const tb = b.reportAtUtc ? new Date(b.reportAtUtc).getTime() : Number.POSITIVE_INFINITY
    if (ta !== tb) return ta - tb
    return a.ringNo.localeCompare(b.ringNo)
  })

  if (race.tieRule === 'same_rank_skip') {
    let i = 0
    while (i < eligible.length) {
      let j = i + 1
      while (j < eligible.length && eligible[j].speedMPerMin === eligible[i].speedMPerMin) j++
      const rank = i + 1
      const tie = j - i > 1
      for (let k = i; k < j; k++) {
        eligible[k].rank = rank
        eligible[k].isTie = tie
      }
      i = j
    }
  } else {
    for (let i = 0; i < eligible.length; i++) {
      eligible[i].rank = i + 1
      const prev = i > 0 ? eligible[i - 1].speedMPerMin : null
      const next = i < eligible.length - 1 ? eligible[i + 1].speedMPerMin : null
      eligible[i].isTie = eligible[i].speedMPerMin === prev || eligible[i].speedMPerMin === next
    }
  }

  for (const r of eligible) {
    r.isPrize = r.rank !== null && r.rank <= race.prizeRanks
  }

  // 输出顺序：有名字的按名次；其余（异常/缺报）按报到时间、足环号
  const rest = built.filter((r) => r.rank === null)
  rest.sort((a, b) => {
    const ta = a.reportAtUtc ? new Date(a.reportAtUtc).getTime() : Number.POSITIVE_INFINITY
    const tb = b.reportAtUtc ? new Date(b.reportAtUtc).getTime() : Number.POSITIVE_INFINITY
    if (ta !== tb) return ta - tb
    return a.ringNo.localeCompare(b.ringNo)
  })
  return [...eligible, ...rest]
}

const RANK_INF = 99999
function effRank(r: ResultRow): number {
  return r.rank ?? RANK_INF
}

/**
 * 依据上一版本与输入改动，生成 changes（含名次位次变化幅度）。
 * diffRanks > 0 表示名次上升，< 0 表示下降。
 */
export function buildChanges(
  prevRows: ResultRow[] | undefined,
  newRows: ResultRow[],
  edits: InputEdit[]
): ChangeRecord[] {
  const prevMap = new Map(prevRows?.map((r) => [r.entryId, r]) ?? [])
  const newMap = new Map(newRows.map((r) => [r.entryId, r]))

  return edits.map((edit) => {
    let diffRanks = 0
    if (edit.entryId) {
      const o = prevMap.get(edit.entryId)
      const n = newMap.get(edit.entryId)
      diffRanks = effRank(o ?? ({ rank: null } as ResultRow)) - effRank(n ?? ({ rank: null } as ResultRow))
      if (!o && n) diffRanks = 0 // 新增，无旧名次可言
    } else {
      // 全局字段（放飞时间/司放坐标等）：取所有鸽中变化幅度最大者
      let maxAbs = 0
      for (const n of newRows) {
        const o = prevMap.get(n.entryId)
        const d = effRank(o ?? ({ rank: null } as ResultRow)) - effRank(n)
        if (Math.abs(d) > Math.abs(maxAbs)) maxAbs = d
      }
      diffRanks = maxAbs
    }
    return {
      field: edit.field,
      from: edit.from,
      to: edit.to,
      diffRanks,
      entryId: edit.entryId,
      ringNo: edit.ringNo
    }
  })
}

// ---------- 团体赛 ----------
export interface TeamRow {
  loftId: string
  loftName: string
  memberNo: string
  counted: number
  speedSum: number
  rank: number
  isTie: boolean
}

/** 同一会员多羽取前 N 羽分速合计 */
export function teamStandings(rows: ResultRow[], topN: number): TeamRow[] {
  const byLoft = new Map<string, ResultRow[]>()
  for (const r of rows) {
    if (r.rank === null || r.speedMPerMin === null) continue
    const arr = byLoft.get(r.loftId) ?? []
    arr.push(r)
    byLoft.set(r.loftId, arr)
  }
  const out: TeamRow[] = []
  for (const [loftId, arr] of byLoft) {
    arr.sort((a, b) => (b.speedMPerMin ?? 0) - (a.speedMPerMin ?? 0))
    const head = arr.slice(0, Math.max(1, topN))
    out.push({
      loftId,
      loftName: arr[0].loftName,
      memberNo: arr[0].memberNo,
      counted: head.length,
      speedSum: round4(head.reduce((s, r) => s + (r.speedMPerMin ?? 0), 0)),
      rank: 0,
      isTie: false
    })
  }
  out.sort((a, b) => b.speedSum - a.speedSum)
  for (let i = 0; i < out.length; i++) {
    out[i].rank = i + 1
    const prev = i > 0 ? out[i - 1].speedSum : null
    const next = i < out.length - 1 ? out[i + 1].speedSum : null
    out[i].isTie = out[i].speedSum === prev || out[i].speedSum === next
  }
  return out
}

// ---------- 多关赛 ----------
export interface GroupPigeonRow {
  ringNo: string
  loftId: string
  loftName: string
  memberNo: string
  speeds: Record<string, number | null>
  aggregate: number
  rank: number
  isTie: boolean
  completedAll: boolean
}

export function groupStandings(
  group: RaceGroup,
  resultsByRace: Map<string, ResultRow[]>
): GroupPigeonRow[] {
  const byRing = new Map<string, GroupPigeonRow>()

  for (const raceId of group.raceIds) {
    const rows = resultsByRace.get(raceId) ?? []
    for (const r of rows) {
      let row = byRing.get(r.ringNo)
      if (!row) {
        row = {
          ringNo: r.ringNo,
          loftId: r.loftId,
          loftName: r.loftName,
          memberNo: r.memberNo,
          speeds: {},
          aggregate: 0,
          rank: 0,
          isTie: false,
          completedAll: true
        }
        byRing.set(r.ringNo, row)
      }
      row.speeds[raceId] = r.rank !== null ? r.speedMPerMin : null
    }
  }

  const out: GroupPigeonRow[] = []
  for (const row of byRing.values()) {
    let wsum = 0
    let w = 0
    let all = true
    for (const raceId of group.raceIds) {
      const s = row.speeds[raceId]
      const weight = group.mode === 'weighted' ? group.weights[raceId] ?? 1 : 1
      if (s === null || s === undefined) {
        all = false
        continue
      }
      wsum += s * weight
      w += weight
    }
    row.completedAll = all
    if (w > 0) row.aggregate = round4(group.mode === 'sum' ? wsum : wsum / w)
    if (all) out.push(row) // 多关排名只计入关关有效鸽
  }

  out.sort((a, b) => b.aggregate - a.aggregate)
  for (let i = 0; i < out.length; i++) {
    out[i].rank = i + 1
    const prev = i > 0 ? out[i - 1].aggregate : null
    const next = i < out.length - 1 ? out[i + 1].aggregate : null
    out[i].isTie = out[i].aggregate === prev || out[i].aggregate === next
  }
  return out
}

/** 判断两个版本的行集合是否有任何实质差异（用于决定是否生成新版本） */
export function resultsDiffer(a: ResultRow[], b: ResultRow[]): boolean {
  if (a.length !== b.length) return true
  const am = new Map(a.map((r) => [r.entryId, r]))
  for (const rb of b) {
    const ra = am.get(rb.entryId)
    if (!ra) return true
    if (
      ra.rank !== rb.rank ||
      ra.speedMPerMin !== rb.speedMPerMin ||
      ra.distanceM !== rb.distanceM ||
      ra.flightSeconds !== rb.flightSeconds ||
      ra.flagged !== rb.flagged ||
      ra.confirmed !== rb.confirmed
    ) {
      return true
    }
  }
  return false
}

export function latestVersion(versions: ResultVersion[], raceId: string): ResultVersion | undefined {
  const list = versions.filter((v) => v.raceId === raceId)
  return list.length ? list[list.length - 1] : undefined
}

export function flagText(f: FlagKind | null): string {
  switch (f) {
    case 'before_release':
      return '报到早于放飞'
    case 'speed_too_high':
      return '分速异常偏高·待核实'
    case 'missing_report':
      return '未报到'
    default:
      return ''
  }
}
