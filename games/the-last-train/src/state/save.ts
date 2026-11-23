// 本地持久化：优先 IndexedDB，不可用时（隐私模式 / 测试环境）退回 localStorage，再不行就只存在内存里。

const DB_NAME = 'the-last-train'
const STORE = 'kv'

let dbPromise: Promise<IDBDatabase | null> | null = null
const memory = new Map<string, string>()

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

function lsGet(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(`${DB_NAME}:${key}`)
  } catch { /* 被禁用 */ }
  return memory.get(key) ?? null
}
function lsSet(key: string, v: string | null) {
  try {
    if (typeof localStorage !== 'undefined') {
      if (v === null) localStorage.removeItem(`${DB_NAME}:${key}`)
      else localStorage.setItem(`${DB_NAME}:${key}`, v)
      return
    }
  } catch { /* 被禁用 */ }
  if (v === null) memory.delete(key)
  else memory.set(key, v)
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const db = await openDb()
  if (!db) {
    const s = lsGet(key)
    return s ? (JSON.parse(s) as T) : null
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly')
      const r = tx.objectStore(STORE).get(key)
      r.onsuccess = () => {
        const v = r.result
        resolve(v === undefined ? null : typeof v === 'string' ? (JSON.parse(v) as T) : (v as T))
      }
      r.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export async function kvSet(key: string, value: unknown): Promise<boolean> {
  const json = JSON.stringify(value)
  const db = await openDb()
  if (!db) {
    lsSet(key, json)
    return true
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(json, key)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => {
        lsSet(key, json)
        resolve(false)
      }
    } catch {
      lsSet(key, json)
      resolve(false)
    }
  })
}

export async function kvDelete(key: string): Promise<void> {
  const db = await openDb()
  lsSet(key, null)
  if (!db) return
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

/** 测试用：重置连接 */
export function _resetDbForTests() {
  dbPromise = null
  memory.clear()
}
