// 一键载入示例赛事（全部为虚构会员/虚构成绩；数据来自本地打包的 public/samples，无外网请求）
import { parseDelimited } from '@/lib/csv'
import { parseDms } from '@/lib/geo'
import { shanghaiInputToUtcIso } from '@/lib/time'
import { uid } from '@/lib/util'
import type { Race, Loft, Entry, ReportChannel } from '@/types'
import { idbPut, idbBulkPut } from '@/db/db'
import { store } from './store'

const CHANNEL: Record<string, ReportChannel> = {
  电子踏板: 'epad',
  电话: 'phone',
  鸽钟: 'clock',
  手工: 'manual'
}

export async function loadSampleRace(): Promise<string> {
  const [loftText, reportText] = await Promise.all([
    fetch('samples/lofts-sample.csv').then((r) => {
      if (!r.ok) throw new Error('示例鸽舍数据缺失')
      return r.text()
    }),
    fetch('samples/reports-sample.csv').then((r) => {
      if (!r.ok) throw new Error('示例报到数据缺失')
      return r.text()
    })
  ])

  const raceId = uid('race')
  const race: Race = {
    id: raceId,
    name: `2026 秋季示例赛（虚构数据）${new Date().getMonth() + 1}月场`,
    releasePoint: { lat: 31 + 10 / 60, lon: 121 + 15 / 60 },
    releaseAtUtc: shanghaiInputToUtcIso('2026-09-20T06:30:00'),
    judge: store.operator.value,
    expectedBirds: 36,
    prizeRanks: 10,
    distanceMethod: 'vincenty',
    tieRule: 'same_rank_skip',
    abnormalSpeedMm: 2000,
    createdAt: Date.now()
  }

  // 鸽舍（已存在相同会员号则复用）
  const loftRows = parseDelimited(loftText).slice(1)
  const loftByMember = new Map<string, Loft>()
  for (const r of loftRows) {
    const [memberNo, name, latDms, lonDms, phone] = r
    let loft = store.state.lofts.find((l) => l.memberNo === memberNo.trim())
    if (!loft) {
      loft = {
        id: uid('loft'),
        memberNo: memberNo.trim(),
        name: name.trim(),
        geo: { lat: parseDms(latDms), lon: parseDms(lonDms) },
        phone: phone.trim()
      }
      store.state.lofts.push(loft)
    }
    loftByMember.set(memberNo.trim(), loft)
  }

  // 报到行（报名与报到时间一起生成；足环顺序按文件行序，每舍 3 羽）
  const reportRows = parseDelimited(reportText).slice(1)
  const ringToLoft = new Map<string, Loft>()
  // 报告文件未带会员号：按每 3 羽一舍映射（与生成器一致），并为缺报鸽补登记
  const ringsAll: string[] = []
  for (const r of reportRows) ringsAll.push(r[0].trim())
  // 缺报的第 36 羽：环号推断 CHN26-001036（与示例约定一致）
  if (!ringsAll.includes('CHN26-001036')) ringsAll.splice(35, 0, 'CHN26-001036')

  const entries: Entry[] = []
  ringsAll.forEach((ring, i) => {
    const loft = [...loftByMember.values()][Math.floor(i / 3)]
    ringToLoft.set(ring, loft)
    entries.push({ id: uid('ent'), raceId, loftId: loft.id, ringNo: ring, reportChannel: 'epad' })
  })

  for (const r of reportRows) {
    const [ring, t, ch] = r
    const e = entries.find((x) => x.ringNo === ring.trim())
    if (!e) continue
    e.reportAtUtc = shanghaiInputToUtcIso(t.trim().replace(' ', 'T'))
    e.reportChannel = CHANNEL[ch.trim()] ?? 'epad'
  }

  store.state.races.push(race)
  store.state.entries.push(...entries)
  await idbPut('races', race)
  await idbBulkPut('lofts', [...loftByMember.values()])
  await idbBulkPut('entries', entries)
  await store.recalcRace(raceId, '载入示例赛事')
  return raceId
}
