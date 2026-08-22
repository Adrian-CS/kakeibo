/**
 * Vista "Juntos": combina mis datos con los de mi pareja (ya vinculada, ver
 * `state/household.tsx`) solo para mostrarlos — nunca se construye un
 * `AppData` combinado de verdad, para que no haya ninguna posibilidad de que
 * algo intente guardarlo o subirlo por error.
 *
 * Cada funcion llama dos veces (una por documento) a la funcion equivalente
 * de `calc.ts` y suma los resultados; no reimplementa ningun calculo de
 * negocio. Devuelven la MISMA forma que `calc.ts` para poder alimentar los
 * mismos componentes de grafico sin tocarlos.
 */
import {
  computeStats,
  computeYoy,
  datedCount,
  daysInMonth,
  hasRealSpend,
  median,
  monthBurn,
  monthTotals,
  noCostItems,
  normalizeLabel,
  projectSavings,
  snapshotSeries,
  sum,
  topExpenses,
  topLabels,
  type BurnPoint,
  type LabelStat,
  type MonthPoint,
  type MonthTotals,
  type SavingsHorizon,
  type SnapshotTotals,
  type Stats,
  type StatsOptions,
  type Yoy,
  type YoyPoint,
} from './calc'
import type { AppData, Category, CategoryLink, Expense } from './types'

/**
 * Une mi lista de categorias con las de mi pareja que no tengan equivalente
 * mia: los ids quedan prefijados ("mine:"/"partner:") para que nunca choquen
 * entre los dos documentos, y coinciden con las claves que usan
 * `combinedMonthTotals`/`combinedStats` en su `byCategory`.
 */
export function combinedCategories(
  mine: Category[],
  partner: Category[],
  links: CategoryLink[],
): Category[] {
  const linkedPartnerIds = new Set(links.map((l) => l.partnerCategoryId))
  const mineOut = mine.filter((c) => !c.archived).map((c) => ({ ...c, id: `mine:${c.id}` }))
  const partnerOnly = partner
    .filter((c) => !c.archived && !linkedPartnerIds.has(c.id))
    .map((c) => ({ ...c, id: `partner:${c.id}` }))
  return [...mineOut, ...partnerOnly]
}

/** Traduce el id de una categoria (mia o de mi pareja) a su clave combinada. */
function combinedKey(categoryId: string, isMine: boolean, partnerToMine: Map<string, string>): string {
  if (isMine) return `mine:${categoryId}`
  const linked = partnerToMine.get(categoryId)
  return linked ? `mine:${linked}` : `partner:${categoryId}`
}

function mergeByCategory(
  mine: Record<string, number>,
  partner: Record<string, number>,
  partnerToMine: Map<string, string>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, v] of Object.entries(mine)) out[`mine:${id}`] = (out[`mine:${id}`] ?? 0) + v
  for (const [id, v] of Object.entries(partner)) {
    const key = combinedKey(id, false, partnerToMine)
    out[key] = (out[key] ?? 0) + v
  }
  return out
}

/** `monthTotals` de mi mes mas el de mi pareja, en el mismo mes. */
export function combinedMonthTotals(
  mine: AppData,
  partner: AppData | null,
  monthId: string,
  links: CategoryLink[],
): MonthTotals {
  const a = monthTotals(mine, monthId)
  if (!partner) return a
  const b = monthTotals(partner, monthId)
  const partnerToMine = new Map(links.map((l) => [l.partnerCategoryId, l.categoryId]))
  const totalJpy = a.totalJpy + b.totalJpy
  const limitJpy = a.limitJpy + b.limitJpy

  return {
    monthId,
    byCategory: mergeByCategory(a.byCategory, b.byCategory, partnerToMine),
    itemsJpy: a.itemsJpy + b.itemsJpy,
    rentJpy: a.rentJpy + b.rentJpy,
    extrasJpy: a.extrasJpy + b.extrasJpy,
    totalJpy,
    dailyLifeJpy: a.dailyLifeJpy + b.dailyLifeJpy,
    fixedJpy: a.fixedJpy + b.fixedJpy,
    otherJpy: a.otherJpy + b.otherJpy,
    extraordinaryJpy: a.extraordinaryJpy + b.extraordinaryJpy,
    noCostJpy: a.noCostJpy + b.noCostJpy,
    noCostCount: a.noCostCount + b.noCostCount,
    limitJpy,
    incomeJpy: a.incomeJpy + b.incomeJpy,
    balanceJpy: a.balanceJpy + b.balanceJpy,
    usedRatio: limitJpy > 0 ? totalJpy / limitJpy : 0,
    // cosmetico: el tipo de cambio es para pasar a la moneda secundaria de
    // quien mira la pantalla, no hay un "tipo de cambio combinado" real
    fxRate: a.fxRate,
    count: a.count + b.count,
    perDayJpy: a.perDayJpy + b.perDayJpy,
  }
}

/** `computeStats` de los dos documentos, mes a mes. */
export function combinedStats(
  mine: AppData,
  partner: AppData | null,
  links: CategoryLink[],
  opts: StatsOptions = {},
): Stats {
  const a = computeStats(mine, opts)
  if (!partner) return a
  const b = computeStats(partner, opts)
  const partnerToMine = new Map(links.map((l) => [l.partnerCategoryId, l.categoryId]))

  const monthIds = [...new Set([...a.months.map((m) => m.monthId), ...b.months.map((m) => m.monthId)])].sort()
  const months: MonthPoint[] = monthIds.map((monthId) => {
    const ma = a.months.find((m) => m.monthId === monthId)
    const mb = b.months.find((m) => m.monthId === monthId)
    return {
      monthId,
      totalJpy: (ma?.totalJpy ?? 0) + (mb?.totalJpy ?? 0),
      byCategory: mergeByCategory(ma?.byCategory ?? {}, mb?.byCategory ?? {}, partnerToMine),
      dailyLifeJpy: (ma?.dailyLifeJpy ?? 0) + (mb?.dailyLifeJpy ?? 0),
      fixedJpy: (ma?.fixedJpy ?? 0) + (mb?.fixedJpy ?? 0),
      otherJpy: (ma?.otherJpy ?? 0) + (mb?.otherJpy ?? 0),
      limitJpy: (ma?.limitJpy ?? 0) + (mb?.limitJpy ?? 0),
      perDayJpy: (ma?.perDayJpy ?? 0) + (mb?.perDayJpy ?? 0),
      fxRate: ma?.fxRate ?? mb?.fxRate ?? 0,
      count: (ma?.count ?? 0) + (mb?.count ?? 0),
    }
  })

  const current = months.at(-1)
  const previous = months.at(-2)

  // igual que en computeStats: media, mediana y extremos solo cuentan meses
  // en los que alguno de los dos tuvo gasto real, para que un mes que
  // ninguno de los dos uso de verdad no rebaje la media ni gane "mas barato"
  // por defecto
  const active = months.filter((m) => hasRealSpend(mine, m.monthId) || hasRealSpend(partner, m.monthId))
  const activeTotals = active.map((m) => m.totalJpy)

  const byCategory: Record<string, number> = {}
  for (const m of months) {
    for (const [k, v] of Object.entries(m.byCategory)) byCategory[k] = (byCategory[k] ?? 0) + v
  }
  const avgByCategory: Record<string, number> = {}
  for (const [k, v] of Object.entries(byCategory)) avgByCategory[k] = months.length ? v / months.length : 0
  const totalJpy = sum(months.map((m) => m.totalJpy))
  const days = sum(monthIds.map(daysInMonth))

  return {
    months,
    currentJpy: current?.totalJpy ?? 0,
    previousJpy: previous?.totalJpy ?? 0,
    momRatio:
      previous && previous.totalJpy > 0 && current ? current.totalJpy / previous.totalJpy - 1 : 0,
    averageJpy: activeTotals.length ? sum(activeTotals) / activeTotals.length : 0,
    medianJpy: median(activeTotals),
    maxMonth: active.length ? active.reduce((x, y) => (y.totalJpy > x.totalJpy ? y : x)) : undefined,
    minMonth: active.length ? active.reduce((x, y) => (y.totalJpy < x.totalJpy ? y : x)) : undefined,
    activeMonthCount: active.length,
    byCategory,
    avgByCategory,
    totalJpy,
    perDayJpy: days ? totalJpy / days : 0,
  }
}

/**
 * Patrimonio combinado por fecha: en cada fecha en que cualquiera de los dos
 * tiene una foto, se suma el ultimo valor conocido de cada lado (no hace
 * falta que las fotos coincidan de fecha exacta).
 */
export function combinedSnapshotSeries(mine: AppData, partner: AppData | null): SnapshotTotals[] {
  const a = snapshotSeries(mine)
  if (!partner) return a
  const b = snapshotSeries(partner)
  const dates = [...new Set([...a.map((s) => s.date), ...b.map((s) => s.date)])].sort()

  let ai = 0
  let bi = 0
  let lastA: SnapshotTotals | undefined
  let lastB: SnapshotTotals | undefined
  const out: SnapshotTotals[] = []
  for (const date of dates) {
    while (ai < a.length && a[ai].date <= date) {
      lastA = a[ai]
      ai++
    }
    while (bi < b.length && b[bi].date <= date) {
      lastB = b[bi]
      bi++
    }
    const assetsJpy = (lastA?.assetsJpy ?? 0) + (lastB?.assetsJpy ?? 0)
    const debtsJpy = (lastA?.debtsJpy ?? 0) + (lastB?.debtsJpy ?? 0)
    out.push({ id: `combined:${date}`, date, assetsJpy, debtsJpy, netJpy: assetsJpy - debtsJpy })
  }
  return out
}

/** Suma horizonte a horizonte los tres escenarios de `projectSavings` de cada lado. */
export function combinedProjectSavings(
  mine: AppData,
  partner: AppData | null,
  horizons: number[],
): SavingsHorizon[] {
  const a = projectSavings(mine, horizons)
  if (!partner) return a
  const b = projectSavings(partner, horizons)
  if (a.length === 0 && b.length === 0) return []

  return horizons.map((months) => {
    const ha = a.find((h) => h.months === months)
    const hb = b.find((h) => h.months === months)
    return {
      months,
      worstCaseJpy: (ha?.worstCaseJpy ?? 0) + (hb?.worstCaseJpy ?? 0),
      worstCaseByCategoryJpy: (ha?.worstCaseByCategoryJpy ?? 0) + (hb?.worstCaseByCategoryJpy ?? 0),
      realisticJpy:
        ha?.realisticJpy == null && hb?.realisticJpy == null
          ? null
          : (ha?.realisticJpy ?? 0) + (hb?.realisticJpy ?? 0),
    }
  })
}

/** Traduce el `categoryId` de cada resultado (gasto o ranking de conceptos) al esquema combinado. */
function remapCategoryId<T extends { categoryId: string }>(
  items: T[],
  isMine: boolean,
  partnerToMine: Map<string, string>,
): T[] {
  return items.map((it) => ({ ...it, categoryId: combinedKey(it.categoryId, isMine, partnerToMine) }))
}

/**
 * Ranking de comercios/conceptos de los dos, sumando lo que coincide por
 * nombre normalizado. Pide el ranking completo (sin limite) de cada lado
 * para no perder aportes que quedarian fuera del top individual de cada
 * uno, junta por nombre y solo entonces recorta al limite pedido.
 */
export function combinedTopLabels(
  mine: AppData,
  partner: AppData | null,
  links: CategoryLink[],
  opts: StatsOptions & { limit?: number; monthIds?: string[] } = {},
): LabelStat[] {
  const partnerToMine = new Map(links.map((l) => [l.partnerCategoryId, l.categoryId]))
  const a = remapCategoryId(topLabels(mine, { ...opts, limit: undefined }), true, partnerToMine)
  const b = partner ? remapCategoryId(topLabels(partner, { ...opts, limit: undefined }), false, partnerToMine) : []

  const map = new Map<string, LabelStat>()
  for (const l of [...a, ...b]) {
    const key = normalizeLabel(l.label)
    const cur = map.get(key)
    if (cur) {
      cur.totalJpy += l.totalJpy
      cur.count += l.count
      cur.avgJpy = cur.totalJpy / cur.count
    } else {
      map.set(key, { ...l })
    }
  }
  const out = [...map.values()].sort((x, y) => y.totalJpy - x.totalJpy)
  return opts.limit ? out.slice(0, opts.limit) : out
}

/** Gastos individuales mas grandes de los dos, mezclados y recortados juntos. */
export function combinedTopExpenses(
  mine: AppData,
  partner: AppData | null,
  links: CategoryLink[],
  opts: StatsOptions & { limit?: number; monthIds?: string[] } = {},
): Expense[] {
  const partnerToMine = new Map(links.map((l) => [l.partnerCategoryId, l.categoryId]))
  const a = remapCategoryId(topExpenses(mine, { ...opts, limit: Infinity }), true, partnerToMine).map((e) => ({
    ...e,
    id: `mine:${e.id}`,
  }))
  const b = partner
    ? remapCategoryId(topExpenses(partner, { ...opts, limit: Infinity }), false, partnerToMine).map((e) => ({
        ...e,
        id: `partner:${e.id}`,
      }))
    : []
  return [...a, ...b].sort((x, y) => y.amount - x.amount).slice(0, opts.limit ?? 10)
}

/** Apuntes "sin coste" de los dos, mezclados con el mismo orden que la version individual. */
export function combinedNoCostItems(
  mine: AppData,
  partner: AppData | null,
  links: CategoryLink[],
  opts: { monthIds?: string[] } = {},
): Expense[] {
  const partnerToMine = new Map(links.map((l) => [l.partnerCategoryId, l.categoryId]))
  const a = remapCategoryId(noCostItems(mine, opts), true, partnerToMine).map((e) => ({ ...e, id: `mine:${e.id}` }))
  const b = partner
    ? remapCategoryId(noCostItems(partner, opts), false, partnerToMine).map((e) => ({
        ...e,
        id: `partner:${e.id}`,
      }))
    : []
  return [...a, ...b].sort((x, y) => y.monthId.localeCompare(x.monthId) || y.amount - x.amount)
}

/** `monthBurn` de los dos lados, sumado dia a dia (el ritmo ideal tambien suma los dos limites). */
export function combinedMonthBurn(mine: AppData, partner: AppData | null, monthId: string): BurnPoint[] {
  const a = monthBurn(mine, monthId)
  if (!partner) return a
  const b = monthBurn(partner, monthId)
  return a.map((p, i) => ({
    day: p.day,
    cumulativeJpy: p.cumulativeJpy + (b[i]?.cumulativeJpy ?? 0),
    paceJpy: p.paceJpy + (b[i]?.paceJpy ?? 0),
  }))
}

/** Cuantos gastos del mes (de los dos) tienen dia asignado. */
export function combinedDatedCount(mine: AppData, partner: AppData | null, monthId: string): number {
  return datedCount(mine, monthId) + (partner ? datedCount(partner, monthId) : 0)
}

/**
 * Comparacion con el ano anterior de los dos: mes a mes, un lado cuenta
 * aunque al otro le falte ese año-mes (null solo si a NINGUNO de los dos le
 * consta), igual que hace `combinedProjectSavings` con `realisticJpy`.
 */
export function combinedYoy(
  mine: AppData,
  partner: AppData | null,
  monthId: string,
  opts: StatsOptions = {},
): Yoy {
  const a = computeYoy(mine, monthId, opts)
  if (!partner) return a
  const b = computeYoy(partner, monthId, opts)

  let currentTotal = 0
  let previousTotal = 0
  let comparable = 0
  const points: YoyPoint[] = a.points.map((pa, i) => {
    const pb = b.points[i]
    const currentJpy =
      pa.currentJpy === null && pb.currentJpy === null ? null : (pa.currentJpy ?? 0) + (pb.currentJpy ?? 0)
    const previousJpy =
      pa.previousJpy === null && pb.previousJpy === null ? null : (pa.previousJpy ?? 0) + (pb.previousJpy ?? 0)
    if (currentJpy !== null && previousJpy !== null) {
      currentTotal += currentJpy
      previousTotal += previousJpy
      comparable += 1
    }
    return { month: pa.month, monthId: pa.monthId, currentJpy, previousJpy }
  })

  return {
    year: a.year,
    points,
    currentTotal,
    previousTotal,
    ratio: previousTotal > 0 ? currentTotal / previousTotal - 1 : 0,
    comparable,
  }
}
