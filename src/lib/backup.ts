/**
 * Copias de seguridad automaticas, dentro del propio navegador.
 *
 * Que protegen y que no, porque conviene no confundirse:
 *   - SI: un borrado sin querer, una importacion que machaca lo que habia, una
 *     fusion de la sincronizacion que se lleva algo por delante, o un fallo mio
 *     que corrompa los datos. Se vuelve atras en dos toques.
 *   - NO: perder el movil, o que el navegador borre los datos del sitio. Para
 *     eso estan la sincronizacion en la nube (que ya sube sola) y la copia
 *     manual a un fichero, que siguen siendo el backup de verdad.
 *
 * Viven en IndexedDB y no en localStorage a proposito: ahi caben de sobra y,
 * sobre todo, no compiten por la cuota con los datos de verdad. Una copia que
 * llena el almacenamiento y deja de guardar lo que estas apuntando seria
 * justo lo contrario de una copia de seguridad.
 */
import type { AppData } from './types'
import { serialize } from './storage'

/** Cuantas copias diarias se guardan. */
export const DAILY_KEPT = 7
/** De cuantos meses se guarda ademas una copia (la ultima de cada mes). */
export const MONTHS_KEPT = 12

export interface BackupEntry {
  /** 'YYYY-MM-DD': una copia por dia, la del dia se va pisando */
  id: string
  /** ISO del momento en que se guardo */
  at: string
  /** tamano del JSON, en bytes */
  size: number
  /** el documento entero, en el mismo formato que la copia manual */
  json: string
}

export type BackupMeta = Omit<BackupEntry, 'json'>

export interface BackupStore {
  list(): Promise<BackupMeta[]>
  read(id: string): Promise<string | null>
  write(entry: BackupEntry): Promise<void>
  remove(id: string): Promise<void>
}

/* ------------------------------------------------------------------ *
 * Logica, sin navegador de por medio
 * ------------------------------------------------------------------ */

/** 'YYYY-MM-DD' del dia: el identificador de la copia de ese dia. */
export function backupId(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

/**
 * Que copias se quedan: las `daily` mas recientes, y ademas la ultima de cada
 * uno de los ultimos `months` meses -la foto de como acabo ese mes-. Lo demas
 * se borra, que tampoco es cuestion de guardar dos anos de copias diarias.
 */
export function backupsToKeep(
  metas: BackupMeta[],
  today: Date,
  { daily = DAILY_KEPT, months = MONTHS_KEPT } = {},
): string[] {
  const sorted = [...metas].sort((a, b) => b.id.localeCompare(a.id))
  const keep = new Set(sorted.slice(0, daily).map((m) => m.id))

  const oldest = new Date(today.getFullYear(), today.getMonth() - (months - 1), 1)
  const limit = backupId(oldest).slice(0, 7)
  const monthsSeen = new Set<string>()
  for (const m of sorted) {
    const month = m.id.slice(0, 7)
    if (month < limit || monthsSeen.has(month)) continue
    monthsSeen.add(month)
    keep.add(m.id)
  }
  return [...keep]
}

/**
 * Guarda la copia de hoy (pisando la que hubiera, para que sea la ultima foto
 * del dia) y tira las que ya no tocan. Devuelve la lista que queda.
 *
 * Nunca lanza: una copia que rompa la app al guardarse no valdria para nada.
 */
export async function runDailyBackup(
  store: BackupStore | null,
  data: AppData,
  today = new Date(),
  policy?: { daily?: number; months?: number },
): Promise<BackupMeta[]> {
  if (!store) return []
  try {
    const json = serialize(data)
    await store.write({ id: backupId(today), at: today.toISOString(), size: json.length, json })

    const metas = await store.list()
    const keep = new Set(backupsToKeep(metas, today, policy))
    for (const m of metas) {
      if (!keep.has(m.id)) await store.remove(m.id)
    }
    return (await store.list()).sort((a, b) => b.id.localeCompare(a.id))
  } catch {
    return []
  }
}

/* ------------------------------------------------------------------ *
 * El almacen de verdad (IndexedDB)
 * ------------------------------------------------------------------ */

const DB_NAME = 'kakeibo'
const DB_VERSION = 1
const STORE_NAME = 'backups'

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE_NAME)) {
          req.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      // modo privado, cuota, permisos: sin copias, pero la app sigue igual
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

function run<T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null)
        try {
          const tx = db.transaction(STORE_NAME, mode)
          const req = body(tx.objectStore(STORE_NAME))
          req.onsuccess = () => resolve(req.result as T)
          req.onerror = () => resolve(null)
          tx.oncomplete = () => db.close()
        } catch {
          resolve(null)
        }
      }),
  )
}

/** El almacen real, o null si este navegador no da IndexedDB. */
export function idbBackupStore(): BackupStore | null {
  if (typeof indexedDB === 'undefined') return null
  return {
    async list() {
      const all = (await run<BackupEntry[]>('readonly', (s) => s.getAll())) ?? []
      // la lista no necesita arrastrar el documento entero
      return all.map(({ id, at, size }) => ({ id, at, size }))
    },
    async read(id) {
      const entry = await run<BackupEntry>('readonly', (s) => s.get(id))
      return entry?.json ?? null
    },
    async write(entry) {
      await run('readwrite', (s) => s.put(entry))
    },
    async remove(id) {
      await run('readwrite', (s) => s.delete(id))
    },
  }
}
