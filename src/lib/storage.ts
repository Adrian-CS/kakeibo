import { DATA_VERSION, type AppData } from './types'
import { DEFAULT_SETTINGS, emptyData } from './defaults'

export const STORAGE_KEY = 'kakeibo:data:v1'

/** localStorage puede lanzar (modo privado, cuota). Nunca debe tirar la app. */
function safeStorage(): Storage | null {
  try {
    const s = globalThis.localStorage
    const probe = '__kakeibo_probe__'
    s.setItem(probe, '1')
    s.removeItem(probe)
    return s
  } catch {
    return null
  }
}

/** Rellena huecos de una copia antigua para que la app nunca vea `undefined`. */
export function migrate(raw: unknown): AppData {
  const base = emptyData()
  if (!raw || typeof raw !== 'object') return base
  const d = raw as Partial<AppData>
  const settings = { ...DEFAULT_SETTINGS, ...(d.settings ?? {}) }
  return {
    version: DATA_VERSION,
    categories: Array.isArray(d.categories) && d.categories.length ? d.categories : base.categories,
    expenses: Array.isArray(d.expenses)
      ? d.expenses
          .filter((e) => e && typeof e.amount === 'number' && !!e.monthId)
          .map((e) => ({ ...e, kind: e.kind ?? 'normal' }))
      : [],
    months: Array.isArray(d.months) && d.months.length
      ? d.months.map((m) => ({
          ...m,
          extras: Array.isArray(m.extras) ? m.extras : [],
          incomeJpy: typeof m.incomeJpy === 'number' ? m.incomeJpy : settings.defaultIncomeJpy,
        }))
      : base.months,
    snapshots: Array.isArray(d.snapshots)
      ? d.snapshots.map((s) => ({ ...s, accounts: Array.isArray(s.accounts) ? s.accounts : [] }))
      : [],
    settings,
    // antes se perdian al migrar: una copia exportada/re-importada olvidaba
    // cuando se habia editado por ultima vez y que se habia borrado, asi que
    // lo borrado podia resucitar al sincronizar
    updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : undefined,
    deleted: Array.isArray(d.deleted) ? d.deleted : undefined,
    sync: d.sync && typeof d.sync === 'object' ? d.sync : undefined,
  }
}

export function loadData(): AppData {
  const s = safeStorage()
  if (!s) return emptyData()
  const raw = s.getItem(STORAGE_KEY)
  if (!raw) return emptyData()
  try {
    return migrate(JSON.parse(raw))
  } catch {
    return emptyData()
  }
}

export function saveData(data: AppData): boolean {
  const s = safeStorage()
  if (!s) return false
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

export function clearData(): void {
  safeStorage()?.removeItem(STORAGE_KEY)
}

/** Tamano aproximado de la copia guardada, en bytes. */
export function storageSize(): number {
  const s = safeStorage()
  if (!s) return 0
  return (s.getItem(STORAGE_KEY) ?? '').length
}

export function serialize(data: AppData): string {
  return JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 1)
}

export function deserialize(text: string): AppData {
  return migrate(JSON.parse(text))
}

export function exportFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `kakeibo-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}.json`
}
