/**
 * Fusion de dos copias de los datos (la del dispositivo y la de la nube).
 *
 * La regla es "no perder nada por accidente":
 *   - un apunte que solo esta en un lado, se queda;
 *   - un apunte que esta en los dos, gana la version mas nueva;
 *   - un apunte borrado se queda borrado, porque los borrados dejan una marca
 *     (tombstone) con su fecha; solo resucita si se edito despues de borrarlo.
 *
 * Todo son funciones puras: no tocan red ni almacenamiento, por eso se pueden
 * probar de verdad.
 */
import type { AppData, Category, Expense, MonthData, Snapshot, Tombstone } from './types'

export const MAX_TOMBSTONES = 2000

export function nowIso(): string {
  return new Date().toISOString()
}

/** Devuelve la fecha ISO mas reciente de las dos (cadena vacia si no hay). */
export function newestIso(a?: string, b?: string): string {
  if (!a) return b ?? ''
  if (!b) return a
  return a > b ? a : b
}

interface Identified {
  id: string
  updatedAt?: string
}

/** Une dos listas por id quedandose con la version mas nueva de cada elemento. */
export function mergeById<T extends Identified>(
  mine: T[],
  theirs: T[],
  fallbackMine: string,
  fallbackTheirs: string,
): T[] {
  const out = new Map<string, { item: T; at: string }>()
  for (const item of mine) out.set(item.id, { item, at: item.updatedAt ?? fallbackMine })
  for (const item of theirs) {
    const at = item.updatedAt ?? fallbackTheirs
    const cur = out.get(item.id)
    if (!cur || at > cur.at) out.set(item.id, { item, at })
  }
  return [...out.values()].map((v) => v.item)
}

export function mergeTombstones(mine: Tombstone[], theirs: Tombstone[]): Tombstone[] {
  const out = new Map<string, string>()
  for (const t of [...mine, ...theirs]) {
    const cur = out.get(t.id)
    if (!cur || t.at > cur) out.set(t.id, t.at)
  }
  return [...out.entries()]
    .map(([id, at]) => ({ id, at }))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAX_TOMBSTONES)
}

/**
 * Quita los elementos borrados. Un elemento sobrevive a su marca de borrado
 * solo si se edito despues (lo edite en un movil sin saber que ya estaba
 * borrado en el otro: gana la edicion, que es lo menos destructivo).
 */
function alive<T extends Identified>(items: T[], deleted: Map<string, string>, fallback: string): T[] {
  return items.filter((it) => {
    const at = deleted.get(it.id)
    if (!at) return true
    return (it.updatedAt ?? fallback) > at
  })
}

/** Fusiona la copia local con la remota. El resultado es simetrico. */
export function mergeData(local: AppData, remote: AppData): AppData {
  const localAt = local.updatedAt ?? ''
  const remoteAt = remote.updatedAt ?? ''
  const localNewer = localAt >= remoteAt
  const newer = localNewer ? local : remote

  const tombstones = mergeTombstones(local.deleted ?? [], remote.deleted ?? [])
  const deletedMap = new Map(tombstones.map((t) => [t.id, t.at]))

  const expenses = alive<Expense>(
    mergeById(local.expenses, remote.expenses, localAt, remoteAt),
    deletedMap,
    localNewer ? localAt : remoteAt,
  )

  const snapshots = alive<Snapshot>(
    mergeById(local.snapshots, remote.snapshots, localAt, remoteAt),
    deletedMap,
    localNewer ? localAt : remoteAt,
  )

  // las categorias no llevan fecha propia: gana la copia mas nueva, y las que
  // solo existen en un lado se mantienen (salvo que esten borradas)
  const categories = alive<Category>(
    mergeById<Category & Identified>(
      (localNewer ? local.categories : remote.categories) as (Category & Identified)[],
      (localNewer ? remote.categories : local.categories) as (Category & Identified)[],
      localNewer ? localAt : remoteAt,
      // la copia mas antigua nunca gana un conflicto de categoria
      '',
    ),
    deletedMap,
    '',
  )

  // los meses se fusionan por id; los extras, uno a uno
  const monthsById = new Map<string, MonthData>()
  for (const m of mergeById(local.months, remote.months, localAt, remoteAt)) {
    const mine = local.months.find((x) => x.id === m.id)
    const theirs = remote.months.find((x) => x.id === m.id)
    const extras = alive(
      mergeById(mine?.extras.map((e) => ({ ...e })) ?? [], theirs?.extras ?? [], localAt, remoteAt),
      deletedMap,
      '',
    )
    monthsById.set(m.id, { ...m, extras })
  }
  const months = alive<MonthData>([...monthsById.values()], deletedMap, localNewer ? localAt : remoteAt)

  return {
    version: Math.max(local.version, remote.version),
    categories,
    expenses,
    months: months.sort((a, b) => a.id.localeCompare(b.id)),
    snapshots,
    settings: newer.settings,
    updatedAt: newestIso(localAt, remoteAt),
    deleted: tombstones,
    // el estado de sincronizacion es de este dispositivo: nunca viene de fuera
    sync: local.sync,
  }
}

/**
 * Huella del contenido, insensible al orden: sirve para decidir si hay que
 * subir el documento sin comparar dos JSON enteros.
 */
export function signature(d: AppData): string {
  const total = d.expenses.reduce((a, e) => a + e.amount, 0)
  const extras = d.months.reduce((a, m) => a + m.extras.length, 0)
  return [
    d.expenses.length,
    Math.round(total * 100),
    d.months.length,
    extras,
    d.snapshots.length,
    d.categories.length,
    (d.deleted ?? []).length,
  ].join(':')
}

/** Hay que subir si el remoto no existe, es mas viejo o le falta contenido. */
export function needsPush(merged: AppData, remote: AppData | null): boolean {
  if (!remote) return true
  if ((merged.updatedAt ?? '') > (remote.updatedAt ?? '')) return true
  return signature(merged) !== signature(remote)
}

/** Resumen de lo que ha cambiado al fusionar, para poder contarselo al usuario. */
export interface MergeReport {
  addedExpenses: number
  removedExpenses: number
  addedMonths: number
}

export function mergeReport(local: AppData, merged: AppData): MergeReport {
  const localIds = new Set(local.expenses.map((e) => e.id))
  const mergedIds = new Set(merged.expenses.map((e) => e.id))
  const localMonths = new Set(local.months.map((m) => m.id))
  return {
    addedExpenses: [...mergedIds].filter((id) => !localIds.has(id)).length,
    removedExpenses: [...localIds].filter((id) => !mergedIds.has(id)).length,
    addedMonths: merged.months.filter((m) => !localMonths.has(m.id)).length,
  }
}
