import { DATA_VERSION, type AppData, type Category, type MonthData, type Settings } from './types'
import { uid } from './id'

/**
 * Las cinco categorias del Excel original. El orden de `colorSlot` respeta
 * el orden fijo de la paleta categorica (nunca se cicla ni se reordena).
 */
export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'eating_out', name: 'Comer fuera', nameJa: '外食', bucket: 'daily', colorSlot: 0 },
  { id: 'groceries', name: 'Supermercado', nameJa: 'スーパーマーケット', bucket: 'daily', colorSlot: 1 },
  { id: 'fixed_transport', name: 'Ropa, transporte y mensuales', nameJa: '服装と電車と毎月費消', bucket: 'other', colorSlot: 2 },
  { id: 'leisure', name: 'Ocio', nameJa: '娯楽', bucket: 'other', colorSlot: 3 },
  { id: 'home', name: 'Cosas de casa', nameJa: '部屋のもの', bucket: 'other', colorSlot: 4 },
]

export const DEFAULT_SETTINGS: Settings = {
  lang: 'es',
  theme: 'system',
  defaultFxRate: 0.0056,
  defaultLimitJpy: 200000,
  defaultRentJpy: 82000,
  // 0 = sin configurar: la previsión de ahorro se queda oculta hasta que se
  // ponga un valor real en Ajustes
  defaultIncomeJpy: 0,
  defaultExtras: [],
  secondaryCurrency: 'EUR',
  autoFillFixed: true,
  autoFxRate: false,
  autoDebtOnOverspend: false,
  autoDebtTarget: 'lastSnapshot',
}

/** 'YYYY-MM' del mes indicado (por defecto, hoy). */
export function monthIdOf(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export function newMonth(id: string, settings: Settings): MonthData {
  return {
    id,
    rentJpy: settings.defaultRentJpy,
    // id nuevo por cada mes: si luego se copia a otro mes (o se vuelve a
    // generar aqui), cada extra tiene que quedar como un apunte distinto
    extras: (settings.defaultExtras ?? []).map((x) => ({ ...x, id: uid('x') })),
    fxRate: settings.defaultFxRate,
    limitJpy: settings.defaultLimitJpy,
    incomeJpy: settings.defaultIncomeJpy ?? 0,
  }
}

export function emptyData(now = new Date()): AppData {
  const settings = { ...DEFAULT_SETTINGS }
  return {
    version: DATA_VERSION,
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    expenses: [],
    months: [newMonth(monthIdOf(now), settings)],
    snapshots: [],
    settings,
  }
}
