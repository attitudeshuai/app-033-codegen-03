// 报到数据批量导入：CSV/TSV（Excel 另存 CSV 或直接复制粘贴），两步 dry_run（规格书 §4.3 §8）
import { parseDelimited } from '@/lib/csv'
import { shanghaiInputToUtcIso } from '@/lib/time'
import { idbPut } from '@/db/db'
import type { Entry, ReportChannel } from '@/types'
import type { InputEdit } from '@/lib/calc'
import { entriesOf, store } from './store'

export interface ImportPreviewItem {
  line: number
  entry: Entry
  ringNo: string
  reportLocal: string
  reportUtc: string
  channel: ReportChannel
  isNew: boolean // 之前无报到时间
}

export interface ImportErrorItem {
  line: number
  ringNo: string
  reason: string
}

export interface ImportPreview {
  items: ImportPreviewItem[]
  errors: ImportErrorItem[]
  updateCount: number
  createCount: number
}

const CHANNEL_MAP: Record<string, ReportChannel> = {
  电子踏板: 'epad',
  踏板: 'epad',
  epad: 'epad',
  电话: 'phone',
  phone: 'phone',
  鸽钟: 'clock',
  clock: 'clock',
  手工: 'manual',
  manual: 'manual'
}

function normTime(s: string): string {
  // 2026/9/20 9:8:5 → 2026-09-20T09:08:05
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(s.trim())
  if (!m) throw new Error(`报到时间格式无法识别：${s}`)
  const [, y, mo, d, h, mi, se] = m
  const pad = (n: string): string => String(Number(n)).padStart(2, '0')
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(se ?? '0')}`
}

function findHeader(headers: string[], aliases: string[]): number {
  for (const a of aliases) {
    const i = headers.findIndex((h) => h.trim().toLowerCase() === a.toLowerCase())
    if (i !== -1) return i
  }
  return -1
}

/** dry_run：只预览，不落库、不产生版本 */
export function previewReportImport(raceId: string, raw: string): ImportPreview {
  const rows = parseDelimited(raw).filter((r) => r.some((v) => v.trim() !== ''))
  const items: ImportPreviewItem[] = []
  const errors: ImportErrorItem[] = []

  if (rows.length === 0) {
    return { items, errors, updateCount: 0, createCount: 0 }
  }

  // 表头识别（首行含「足环/ring」即视为表头，否则按固定列序）
  const firstRow = rows[0].map((v) => v.trim())
  let ringCol = findHeader(firstRow, ['足环号', '足环', '环号', 'ringno', 'ring'])
  let timeCol = findHeader(firstRow, ['报到时间', '报到', '时间', 'reportat', 'time'])
  let channelCol = findHeader(firstRow, ['报到方式', '方式', 'channel'])
  let dataRows: string[][]
  let lineOffset: number

  if (ringCol !== -1) {
    if (timeCol === -1) timeCol = ringCol + 1
    dataRows = rows.slice(1)
    lineOffset = 2 // 数据首行在文件中的行号
  } else {
    ringCol = 0
    timeCol = 1
    channelCol = 2
    dataRows = rows
    lineOffset = 1
  }

  const raceEntries = entriesOf(raceId)
  const seenRings = new Map<string, number>()

  dataRows.forEach((cols, i) => {
    const line = lineOffset + i
    const ringNo = (cols[ringCol] ?? '').trim()
    if (!ringNo) return // 空行不报错（过滤过的兜底）

    // 文件内重复足环 → 精确定位行号
    if (seenRings.has(ringNo)) {
      errors.push({ line, ringNo, reason: `足环号在文件中重复（首次出现于第 ${seenRings.get(ringNo)} 行）` })
      return
    }
    seenRings.set(ringNo, line)

    const entry = raceEntries.find((e) => e.ringNo === ringNo)
    if (!entry) {
      errors.push({ line, ringNo, reason: '该足环号未报名（参赛鸽中不存在）' })
      return
    }

    const timeRaw = (cols[timeCol] ?? '').trim()
    if (!timeRaw) {
      errors.push({ line, ringNo, reason: '缺少报到时间' })
      return
    }

    let reportLocal = ''
    try {
      reportLocal = normTime(timeRaw)
    } catch (e) {
      errors.push({ line, ringNo, reason: (e as Error).message })
      return
    }

    let reportUtc = ''
    try {
      reportUtc = shanghaiInputToUtcIso(reportLocal)
    } catch (e) {
      errors.push({ line, ringNo, reason: (e as Error).message })
      return
    }

    const channelRaw = channelCol !== -1 ? (cols[channelCol] ?? '').trim() : ''
    const channel = CHANNEL_MAP[channelRaw] ?? (channelRaw === '' ? 'epad' : 'manual')

    items.push({
      line,
      entry,
      ringNo,
      reportLocal,
      reportUtc,
      channel,
      isNew: !entry.reportAtUtc
    })
  })

  return {
    items,
    errors,
    createCount: items.filter((i) => i.isNew).length,
    updateCount: items.filter((i) => !i.isNew).length
  }
}

/** 正式导入：按足环匹配更新报到记录；重传只更新不重复，完成后重算 */
export async function commitReportImport(preview: ImportPreview): Promise<void> {
  if (preview.errors.length > 0) throw new Error('存在错误行，请修正后再正式导入')

  // 先快照改动（改前值），再落库，最后统一重算（重传只更新、不新增、不重复）
  const raceId = preview.items[0]?.entry.raceId
  const edits: InputEdit[] = preview.items.map((it) => ({
    field: '批量导入报到时间',
    from: it.isNew ? null : it.entry.reportAtUtc ?? null,
    to: it.reportUtc,
    entryId: it.entry.id,
    ringNo: it.ringNo
  }))

  for (const item of preview.items) {
    const e = item.entry
    e.reportAtUtc = item.reportUtc
    e.reportChannel = item.channel
    await idbPut('entries', e)
  }
  if (raceId) {
    await store.recalcRace(raceId, `批量导入报到 ${preview.items.length} 条`, edits)
  }
}
