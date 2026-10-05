// 通用小工具

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/** 分速保留 4 位小数（并列判定口径以此为准） */
export function round4(v: number): number {
  return Math.round((v + Number.EPSILON) * 10000) / 10000
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 时间戳 → 文件名字安全串 YYYYMMDD-HHmmss */
export function stampForFile(ms: number): string {
  const d = new Date(ms)
  const p = pad2.bind(null)
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}
