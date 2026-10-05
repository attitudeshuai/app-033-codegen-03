// 地理计算：度分秒换算 + 球面/椭球距离（规格书 §8 命门：绝不用平面欧氏距离）
import type { Geo, DistanceMethod } from '@/types'

// ---------- 常量 ----------
export const EARTH_R_KM = 6371.0088 // Haversine 平均半径
const WGS84_A = 6378137.0 // 长半轴（米）
const WGS84_F = 1 / 298.257223563 // 扁率
const WGS84_B = WGS84_A * (1 - WGS84_F)

export function toRad(d: number): number {
  return (d * Math.PI) / 180
}

// ---------- 度分秒 ----------
export interface DmsParts {
  sign: 1 | -1
  deg: number
  min: number
  sec: number
}

/**
 * 解析度分秒字符串，返回十进制度。
 * 支持：31°12'36" / 31:12:36 / 31 12 36 / 31度12分36秒 / 31.21
 * 半球：N/S/E/W（可在首尾）、中文 南/北/东/西；负号或 S/W 取负。
 */
export function parseDms(raw: string): number {
  if (typeof raw !== 'string') throw new Error('坐标必须是字符串')
  let s = raw.trim()
  if (s === '') throw new Error('坐标为空')

  let sign: 1 | -1 = 1
  // 半球字母/中文（任意位置先取出）
  if (/[SWsw]/.test(s) || /南|西/.test(s)) sign = -1
  s = s.replace(/[NSEWnsew]/g, '').replace(/[南北东西]/g, '')
  s = s.trim()

  if (/^-/.test(s)) {
    sign = -1
    s = s.slice(1).trim()
  } else if (/^\+/.test(s)) {
    s = s.slice(1).trim()
  }

  // 抽取数字（含小数），分隔符：° ' " 度 分 秒 : 空格
  const matches = s.match(/\d+(?:\.\d+)?/g)
  if (!matches || matches.length === 0) throw new Error(`无法解析坐标：${raw}`)
  const nums = matches.map(Number)

  let decimal: number
  if (nums.length === 1) {
    decimal = nums[0]
  } else if (nums.length === 2) {
    validateMinSec(nums[1], 60, raw)
    decimal = nums[0] + nums[1] / 60
  } else if (nums.length === 3) {
    validateMinSec(nums[1], 60, raw)
    validateMinSec(nums[2], 60, raw)
    decimal = nums[0] + nums[1] / 60 + nums[2] / 3600
  } else {
    throw new Error(`坐标分段过多：${raw}`)
  }

  // 检测输入中是否出现秒符号却被当成别的处理——基本容错：检查度数上限
  if (decimal > 180) throw new Error(`坐标超出范围（>180°）：${raw}`)
  return sign * decimal
}

function validateMinSec(v: number, max: number, raw: string): void {
  if (v < 0 || v >= max) throw new Error(`分/秒必须在 0~${max} 之间：${raw}`)
}

/** 十进制度 → 度分秒分量 */
export function toDmsParts(value: number): DmsParts {
  const sign: 1 | -1 = Object.is(value, -0) || value < 0 ? -1 : 1
  const abs = Math.abs(value)
  const deg = Math.floor(abs)
  const minFull = (abs - deg) * 60
  const min = Math.floor(minFull)
  const sec = (minFull - min) * 60
  return { sign, deg, min, sec }
}

/** 按给定秒小数位归一化（秒/分满 60 进位，规避浮点误差显示成 60″） */
function normalize(p: DmsParts, secDigits: number): { deg: number; min: number; secStr: string } {
  let { deg, min } = p
  let secStr = p.sec.toFixed(secDigits)
  if (Number(secStr) >= 60) {
    secStr = (0).toFixed(secDigits)
    min += 1
  }
  if (min >= 60) {
    min = 0
    deg += 1
  }
  return { deg, min, secStr }
}

/** 十进制度 → 度分秒展示字符串，秒保留 secDigits 位小数 */
export function formatDms(value: number, secDigits = 2): string {
  const n = normalize(toDmsParts(value), secDigits)
  return `${value < 0 || Object.is(value, -0) ? '-' : ''}${n.deg}°${String(n.min).padStart(2, '0')}′${n.secStr.padStart(secDigits === 0 ? 2 : 3 + secDigits, '0')}″`
}

/** 带半球后缀的完整展示（纬度/经度） */
export function formatDmsHemi(value: number, kind: 'lat' | 'lon', secDigits = 2): string {
  const p = toDmsParts(value)
  const n = normalize(p, secDigits)
  const hemi = kind === 'lat' ? (p.sign < 0 ? 'S' : 'N') : p.sign < 0 ? 'W' : 'E'
  return `${n.deg}°${String(n.min).padStart(2, '0')}′${n.secStr.padStart(secDigits === 0 ? 2 : 3 + secDigits, '0')}″ ${hemi}`
}

export function validateGeo(g: Geo): string | null {
  if (!Number.isFinite(g.lat) || Math.abs(g.lat) > 90) return '纬度必须在 -90 ~ 90 之间'
  if (!Number.isFinite(g.lon) || Math.abs(g.lon) > 180) return '经度必须在 -180 ~ 180 之间'
  return null
}

// ---------- Haversine（球面近似） ----------
export function haversineM(a: Geo, b: Geo): number {
  const φ1 = toRad(a.lat)
  const φ2 = toRad(b.lat)
  const dφ = toRad(b.lat - a.lat)
  const dλ = toRad(b.lon - a.lon)
  const h =
    Math.sin(dφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
  return EARTH_R_KM * 1000 * c
}

// ---------- Vincenty（WGS-84 椭球，逆解） ----------
export function vincentyM(p1: Geo, p2: Geo): number {
  const φ1 = toRad(p1.lat)
  const φ2 = toRad(p2.lat)
  const L = toRad(p2.lon - p1.lon)

  const U1 = Math.atan((1 - WGS84_F) * Math.tan(φ1))
  const U2 = Math.atan((1 - WGS84_F) * Math.tan(φ2))
  const sinU1 = Math.sin(U1)
  const cosU1 = Math.cos(U1)
  const sinU2 = Math.sin(U2)
  const cosU2 = Math.cos(U2)

  let λ = L
  let sinσ = 0
  let cosσ = 0
  let σ = 0
  let sinα = 0
  let cosSqα = 0
  let cos2σm = 0
  let λPrev: number
  let iter = 0

  do {
    sinσ = Math.sqrt(
      (cosU2 * Math.sin(λ)) ** 2 +
        (cosU1 * sinU2 - sinU1 * cosU2 * Math.cos(λ)) ** 2
    )
    if (sinσ === 0) return 0 // 重合点
    cosσ = sinU1 * sinU2 + cosU1 * cosU2 * Math.cos(λ)
    σ = Math.atan2(sinσ, cosσ)
    sinα = (cosU1 * cosU2 * Math.sin(λ)) / sinσ
    cosSqα = 1 - sinα * sinα
    cos2σm = cosSqα === 0 ? 0 : cosσ - (2 * sinU1 * sinU2) / cosSqα
    const C = (WGS84_F / 16) * cosSqα * (4 + WGS84_F * (4 - 3 * cosSqα))
    λPrev = λ
    λ =
      L +
      (1 - C) *
        WGS84_F *
        sinα *
        (σ + C * sinσ * (cos2σm + C * cosσ * (-1 + 2 * cos2σm * cos2σm)))
    iter++
  } while (Math.abs(λ - λPrev) > 1e-12 && iter < 200)

  if (iter >= 200) {
    // 对跖点附近不收敛：退回球面公式（仍是球面距离，绝不用平面距离）
    return haversineM(p1, p2)
  }

  const uSq = (cosSqα * (WGS84_A * WGS84_A - WGS84_B * WGS84_B)) / (WGS84_B * WGS84_B)
  const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)))
  const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)))
  const Δσ =
    B *
    sinσ *
    (cos2σm +
      (B / 4) *
        (cosσ * (-1 + 2 * cos2σm * cos2σm) -
          (B / 6) *
            cos2σm *
            (-3 + 4 * sinσ * sinσ) *
            (-3 + 4 * cos2σm * cos2σm)))
  return WGS84_B * A * (σ - Δσ)
}

/** 按指定方法计算距离（米，保留整数） */
export function distanceM(a: Geo, b: Geo, method: DistanceMethod): number {
  const raw = method === 'vincenty' ? vincentyM(a, b) : haversineM(a, b)
  return Math.round(raw)
}
