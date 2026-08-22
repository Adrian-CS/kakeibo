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

/**
 * Marca el documento entero -y cada gasto, mes, categoria y foto de ahorros
 * que contiene- como editado justo ahora. Hace falta al restaurar una copia
 * completa (Importar datos, Borrar todo): sin esto, los apuntes conservan la
 * fecha de edicion que tenian cuando se exportaron, y la siguiente
 * sincronizacion los compara con la version de la nube por esa fecha vieja.
 * Si la nube tiene algo mas reciente con el mismo id, la copia recien
 * importada pierde el pulso del merge y vuelve a lo que habia antes de
 * importar, deshaciendo la restauracion sin avisar.
 *
 * Las categorias entran tambien: si una categoria se borro en algun momento
 * (con su marca de borrado ya en la nube) y la copia que se importa la trae
 * de vuelta, necesita una fecha mas nueva que esa marca para poder
 * resucitar en el siguiente merge -si no, `alive()` la descarta siempre.
 */
export function stampAsNew(data: AppData, at: string = nowIso()): AppData {
  return {
    ...data,
    updatedAt: at,
    categories: data.categories.map((c) => ({ ...c, updatedAt: at })),
    expenses: data.expenses.map((e) => ({ ...e, updatedAt: at })),
    snapshots: data.snapshots.map((s) => ({ ...s, updatedAt: at })),
    months: data.months.map((m) => ({ ...m, updatedAt: at })),
  }
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

/**
 * Un dispositivo "en blanco": recien instalado o recien vaciado. No tiene
 * apuntes, ni fotos de ahorros, ni marcas de borrado; lo unico que puede
 * tener es el mes en curso, creado solo al abrir la app.
 *
 * Distinguirlo importa: al entrar por primera vez en un movil nuevo, lo suyo
 * es adoptar la copia de la nube entera (categorias renombradas, ajustes,
 * idioma) en vez de fusionarla con unos valores por defecto que son mas
 * "nuevos" solo porque el reloj dice que se crearon hace un segundo.
 */
export function isBlankDevice(d: AppData): boolean {
  return (
    d.expenses.length === 0 &&
    d.snapshots.length === 0 &&
    (d.deleted?.length ?? 0) === 0 &&
    d.months.every((m) => m.extras.length === 0)
  )
}

/**
 * Si al sincronizar toca adoptar la copia de la nube entera en vez de
 * fusionarla. Solo la primera vez: si el dispositivo ya sincronizo antes
 * (`sync.lastSyncAt`), sigue siendo "en blanco" segun `isBlankDevice` en
 * cuanto una cuenta apenas acumula gastos o fotos (por ejemplo, una que solo
 * se usa para vincular la pareja) - adoptar la nube en cada ciclo se comeria
 * cualquier ajuste que solo exista en local (un enlace de categoria, un
 * cambio de ajustes...) que la nube todavia no conozca. Pasado el primer
 * sincronizado, toca fusionar siempre, por vacio que siga el dispositivo.
 */
export function shouldAdoptRemote(local: AppData): boolean {
  return isBlankDevice(local) && !local.sync?.lastSyncAt
}

/**
 * Un dispositivo que ya se sincronizo antes con una cuenta, y ahora se acaba
 * de iniciar sesion con OTRA distinta. Fusionar sin avisar mezclaria (o
 * subiria de golpe) los datos de una persona a la cuenta de otra: el correo
 * de la sesion activa se borra al salir (`sync.email`), pero
 * `sync.lastSyncedEmail` no, asi que sobrevive al cambio de cuenta y sirve
 * para detectarlo.
 *
 * Un dispositivo en blanco, o que nunca sincronizo con nadie todavia
 * (`lastSyncedEmail` sin definir: el primer alta de sincronizacion sobre
 * datos locales ya existentes es el caso normal, no una alarma), no cuenta
 * como desajuste.
 */
export function isAccountMismatch(local: AppData, sessionEmail?: string): boolean {
  const lastEmail = local.sync?.lastSyncedEmail
  return !!lastEmail && !!sessionEmail && lastEmail !== sessionEmail && !isBlankDevice(local)
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

  // igual que gastos/fotos: la categoria editada mas tarde gana un conflicto,
  // y las que faltan por fecha propia caen al reloj del documento entero. Sin
  // fecha propia, una categoria borrada (con su marca) no podia distinguir
  // "nunca se volvio a tocar" de "se volvio a crear a proposito" y se perdia
  // para siempre aunque una copia importada la trajera de vuelta
  const categories = alive<Category>(
    mergeById(local.categories, remote.categories, localAt, remoteAt),
    deletedMap,
    localNewer ? localAt : remoteAt,
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
 * subir o aplicar el documento sin comparar dos JSON enteros campo a campo.
 *
 * Incluye el valor de cada campo mutable (no solo recuentos o sumas), para
 * que una edicion sin alta ni baja -cambiar el alquiler, renombrar una
 * categoria, corregir el importe o la nota de un gasto que ya existia-
 * tambien cambie la huella. Antes solo miraba cantidades (numero de gastos,
 * suma de importes...), asi que esas ediciones se quedaban sin subir o sin
 * aplicar al fusionar con otro dispositivo.
 */
export function signature(d: AppData): string {
  const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id))

  const expenses = byId(d.expenses)
    .map((e) => [e.id, e.categoryId, e.label, e.amount, e.day ?? '', e.kind, e.note ?? ''].join('|'))
    .join(';')

  const categories = byId(d.categories)
    .map((c) =>
      [c.id, c.name, c.nameJa ?? '', c.bucket, c.colorSlot, c.archived ? 1 : 0, c.limitJpy ?? ''].join('|'),
    )
    .join(';')

  const months = byId(d.months)
    .map((m) => {
      const extras = byId(m.extras)
        .map((x) => [x.id, x.label, x.amount].join(':'))
        .join(',')
      return [m.id, m.rentJpy, m.fxRate, m.limitJpy, m.note ?? '', extras].join('|')
    })
    .join(';')

  const snapshots = byId(d.snapshots)
    .map((s) => {
      const accounts = byId(s.accounts)
        .map((a) => [a.id, a.amount, a.currency, a.isDebt ? 1 : 0].join(':'))
        .join(',')
      return [s.id, s.date, s.note ?? '', accounts].join('|')
    })
    .join(';')

  const deleted = byId(d.deleted ?? [])
    .map((t) => `${t.id}:${t.at}`)
    .join(';')

  return [expenses, categories, months, snapshots, deleted, JSON.stringify(d.settings)].join('##')
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
