// IndexedDB 极简封装（无第三方依赖），断网可用，数据全部保存在本地浏览器
import type {
  Race,
  Loft,
  Entry,
  ResultVersion,
  Confirmation,
  RaceGroup
} from '@/types'

const DB_NAME = 'pigeon-race-calculator'
const DB_VERSION = 1

export const STORES = [
  'races',
  'lofts',
  'entries',
  'versions',
  'confirmations',
  'groups',
  'meta'
] as const
export type StoreName = (typeof STORES)[number]

let dbPromise: Promise<IDBDatabase> | null = null

/**
 * 深拷贝为普通对象/数组。
 * IndexedDB 的结构化克隆不能克隆 Vue 的响应式 Proxy，会抛
 * `could not be cloned`，因此写入前统一脱去响应式包装。
 */
function plain<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => plain(x)) as unknown as T
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>)) {
      out[k] = plain((v as Record<string, unknown>)[k])
    }
    return out as T
  }
  return v
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (): void => {
      const db = req.result
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, name === 'meta' ? { keyPath: 'k' } : { keyPath: 'id' })
        }
      }
    }
    req.onsuccess = (): void => resolve(req.result)
    req.onerror = (): void => reject(req.error)
  })
  return dbPromise
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = fn(t.objectStore(store))
        req.onsuccess = (): void => resolve(req.result)
        req.onerror = (): void => reject(req.error)
      })
  )
}

export function idbGetAll<T>(store: StoreName): Promise<T[]> {
  return tx(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)
}

export function idbPut<T>(store: StoreName, value: T): Promise<IDBValidKey> {
  return tx(store, 'readwrite', (s) => s.put(plain(value)))
}

export function idbBulkPut<T>(store: StoreName, values: T[]): Promise<void> {
  if (values.length === 0) return Promise.resolve()
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(store, 'readwrite')
        const s = t.objectStore(store)
        for (const v of values) s.put(plain(v))
        t.oncomplete = (): void => resolve()
        t.onerror = (): void => reject(t.error)
      })
  )
}

export function idbDelete(store: StoreName, id: string): Promise<void> {
  return tx(store, 'readwrite', (s) => s.delete(id) as IDBRequest<undefined>).then(() => undefined)
}

/** 清空全部业务数据（meta 除外）：备份恢复时先覆盖旧数据，避免残留记录重新出现 */
export function idbClearAll(): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const names = STORES.filter((n) => n !== 'meta')
        const t = db.transaction(names, 'readwrite')
        for (const n of names) t.objectStore(n).clear()
        t.oncomplete = (): void => resolve()
        t.onerror = (): void => reject(t.error)
      })
  )
}

export function idbGetMeta<T>(k: string): Promise<T | undefined> {
  return tx('meta', 'readonly', (s) => s.get(k) as IDBRequest<{ k: string; v: T } | undefined>).then((r) => r?.v)
}

export function idbSetMeta<T>(k: string, v: T): Promise<IDBValidKey> {
  return idbPut('meta', { k, v })
}

export type DbShape = {
  races: Race[]
  lofts: Loft[]
  entries: Entry[]
  versions: ResultVersion[]
  confirmations: Confirmation[]
  groups: RaceGroup[]
}
