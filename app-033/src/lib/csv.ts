// CSV/TSV 解析与序列化（无第三方依赖），支持引号转义、CRLF；导出带 BOM 供 Excel 直接打开

/** 自动识别分隔符（逗号/制表符/分号），RFC4180 风格解析 */
export function parseDelimited(text: string): string[][] {
  // 去 UTF-8 BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)

  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  let delim = ','
  const counts = {
    ',': (firstLine.match(/,/g) ?? []).length,
    '\t': (firstLine.match(/\t/g) ?? []).length,
    ';': (firstLine.match(/;/g) ?? []).length
  }
  if (counts['\t'] > counts[',']) delim = '\t'
  else if (counts[';'] > counts[','] && counts[','] === 0) delim = ';'

  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === delim) {
      row.push(field)
      field = ''
    } else if (c === '\r') {
      // 忽略，等 \n
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      field = ''
      row = []
    } else {
      field += c
    }
  }
  // 末行（无换行结尾）
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  // 去掉完全空白的尾行
  while (rows.length && rows[rows.length - 1].every((v) => v.trim() === '')) rows.pop()
  return rows
}

function escapeField(v: string, delim = ','): string {
  if (/["\r\n]/.test(v) || v.includes(delim)) {
    return `"${v.replace(/"/g, '""')}"`
  }
  return v
}

/** 序列化；rows 为字符串二维数组 */
export function toDelimited(rows: (string | number | null | undefined)[][], delim = ','): string {
  return rows
    .map((r) => r.map((v) => escapeField(v === null || v === undefined ? '' : String(v), delim)).join(delim))
    .join('\r\n')
}

/** 导出 Excel 可直接打开的 CSV（UTF-8 BOM） */
export function toExcelCsv(rows: (string | number | null | undefined)[][]): string {
  return '﻿' + toDelimited(rows, ',')
}

export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime })
  triggerDownload(URL.createObjectURL(blob), filename)
}

export function downloadBlob(filename: string, blob: Blob): void {
  triggerDownload(URL.createObjectURL(blob), filename)
}

function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = (): void => resolve(String(r.result ?? ''))
    r.onerror = (): void => reject(r.error)
    r.readAsText(file, 'utf-8')
  })
}
