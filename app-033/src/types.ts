// 全局数据模型（对应规格书 §7）

export interface Geo {
  lat: number // 十进制度，南纬为负
  lon: number // 十进制度，西经为负
}

export type DistanceMethod = 'vincenty' | 'haversine'
export type TieRule = 'same_rank_skip' | 'sequential'
export type ReportChannel = 'epad' | 'phone' | 'clock' | 'manual'
export type FlagKind = 'speed_too_high' | 'before_release' | 'missing_report'

export interface Race {
  id: string
  name: string
  releasePoint: Geo
  releaseAtUtc: string // ISO，统一存 UTC
  judge: string
  expectedBirds: number
  prizeRanks: number
  distanceMethod: DistanceMethod
  tieRule: TieRule
  abnormalSpeedMm: number // 异常分速上限，默认 2000
  createdAt: number
}

export interface Loft {
  id: string
  memberNo: string
  name: string
  geo: Geo
  phone?: string
}

export interface Entry {
  id: string
  raceId: string
  loftId: string
  ringNo: string
  gender?: string // 性别（可选）
  color?: string // 羽色（可选）
  reportAtUtc?: string
  reportChannel: ReportChannel
  note?: string
}

export interface ResultRow {
  rank: number | null // 未参与排名为 null
  entryId: string
  loftId: string
  loftName: string
  memberNo: string
  ringNo: string
  distanceM: number | null
  otherDistanceM: number | null // 对照公式的距离
  distanceDiffPct: number | null // 两公式差异百分比
  flightSeconds: number | null
  speedMPerMin: number | null
  isTie: boolean
  isPrize: boolean
  flagged: FlagKind | null
  confirmed: boolean
  reportAtUtc?: string
}

export interface ChangeRecord {
  field: string
  from: unknown
  to: unknown
  diffRanks: number // 正=名次上升，负=下降，0=不变
  entryId?: string
  ringNo?: string
}

export interface ResultVersion {
  id: string
  raceId: string
  version: number
  method: DistanceMethod
  tieRule: TieRule
  releaseAtUtc: string
  rows: ResultRow[]
  computedAt: number
  changes: ChangeRecord[]
  by: string
  note?: string
}

// 人工确认记录（异常分速确认，确认动作留痕）
export interface Confirmation {
  id: string
  raceId: string
  entryId: string
  ringNo: string
  by: string
  at: number
  speedMPerMin: number
}

// 多关赛分组
export type GroupMode = 'sum' | 'avg' | 'weighted'
export interface RaceGroup {
  id: string
  name: string
  raceIds: string[]
  mode: GroupMode
  weights: Record<string, number> // raceId -> 权重
  createdAt: number
}

export interface BackupFile {
  app: 'pigeon-race-calculator'
  exportedAt: number
  by: string
  races: Race[]
  lofts: Loft[]
  entries: Entry[]
  versions: ResultVersion[]
  confirmations: Confirmation[]
  groups: RaceGroup[]
}
