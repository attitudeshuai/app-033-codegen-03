// 时间处理：统一存 UTC，展示按 Asia/Shanghai（规格书 §8）
// 中国自 1991 年起无夏令时；用 Intl 做时区换算以规避任何时区/跨天问题。

const TZ = 'Asia/Shanghai'

export function nowUtcIso(): string {
  return new Date().toISOString()
}

/** 取某 UTC 时刻在 Asia/Shanghai 的墙钟分量 */
function shanghaiParts(utcMs: number): {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
} {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  const parts = dtf.formatToParts(new Date(utcMs))
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value)
  let hour = get('hour')
  if (hour === 24) hour = 0 // 某些环境午夜返回 24
  return { year: get('year'), month: get('month'), day: get('day'), hour, minute: get('minute'), second: get('second') }
}

function shanghaiOffsetMs(utcMs: number): number {
  const p = shanghaiParts(utcMs)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs
}

/**
 * 把 datetime-local 的值（YYYY-MM-DDTHH:mm:ss，视为上海墙钟时间）转成 UTC ISO。
 * 通过 Intl 反查偏移，规避 DST/时区假设。
 */
export function shanghaiInputToUtcIso(local: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim())
  if (!m) throw new Error(`时间格式不正确：${local}`)
  const [, y, mo, d, h, mi, s] = m
  const wallUtcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0))
  // 先用 +8h 尝试，再按该时刻真实偏移校正（应对一切时区规则变化）
  let guess = wallUtcMs - 8 * 3600_000
  for (let i = 0; i < 3; i++) {
    const off = shanghaiOffsetMs(guess)
    const next = wallUtcMs - off
    if (next === guess) break
    guess = next
  }
  return new Date(guess).toISOString()
}

/** UTC ISO → datetime-local 值（上海墙钟，秒精度） */
export function utcIsoToShanghaiInput(iso: string): string {
  const ms = new Date(iso).getTime()
  const p = shanghaiParts(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
}

/** UTC ISO → 上海展示字符串 */
export function formatShanghai(iso: string | undefined, withSeconds = true): string {
  if (!iso) return '—'
  const p = shanghaiParts(new Date(iso).getTime())
  const pad = (n: number): string => String(n).padStart(2, '0')
  const base = `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`
  return withSeconds ? `${base}:${pad(p.second)}` : base
}

/** 飞行秒数 → HH:mm:ss（负值不参与成绩，显示 —） */
export function formatHms(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec < 0) return '—'
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(r)}`
}

/** 飞行秒数 → 中文时长 */
export function formatDurationZh(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return '—'
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return `${h}小时${String(m).padStart(2, '0')}分${String(r).padStart(2, '0')}秒`
}
