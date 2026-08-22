import type { AppData, Category, Expense, MonthData, Snapshot } from './types'

/* ------------------------------------------------------------------ *
 * Utilidades basicas
 * ------------------------------------------------------------------ */

export function sum(xs: number[]): number {
  let t = 0
  for (const x of xs) t += x
  return t
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Numero de dias del mes 'YYYY-MM'. */
export function daysInMonth(monthId: string): number {
  const [y, m] = monthId.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/** Desplaza un 'YYYY-MM' n meses (n puede ser negativo). */
export function shiftMonth(monthId: string, n: number): string {
  const [y, m] = monthId.split('-').map(Number)
  const d = new Date(y, m - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function isValidMonthId(id: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(id)) return false
  const m = Number(id.slice(5, 7))
  return m >= 1 && m <= 12
}

/** Lista continua de meses entre dos 'YYYY-MM' (ambos incluidos). */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = []
  let cur = from
  // tope de seguridad: 100 anos
  for (let i = 0; i < 1200 && cur <= to; i++) {
    out.push(cur)
    cur = shiftMonth(cur, 1)
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Totales de un mes (replica de las formulas del Excel)
 * ------------------------------------------------------------------ */

export interface MonthTotals {
  monthId: string
  /** suma por categoria, en yenes */
  byCategory: Record<string, number>
  /** suma de todas las filas de categoria */
  itemsJpy: number
  rentJpy: number
  extrasJpy: number
  /** 合計 = filas + alquiler + extras */
  totalJpy: number
  /** 一日生活の費消 = categorias del bucket "daily" */
  dailyLifeJpy: number
  /** 毎月ある費消 = gastos marcados como recurrentes + alquiler + extras */
  fixedJpy: number
  /** 別の費消 = total - fijos */
  otherJpy: number
  /** gastos marcados como extraordinarios (informativo) */
  extraordinaryJpy: number
  /** gastos marcados como "sin coste" (informativo, no suman al total) */
  noCostJpy: number
  /** numero de apuntes "sin coste" */
  noCostCount: number
  /** 上限 */
  limitJpy: number
  /** ingresos previstos del mes: base de la prevision de ahorro */
  incomeJpy: number
  /** balance = limite - total */
  balanceJpy: number
  /** porcentaje del limite consumido (0-Infinity) */
  usedRatio: number
  fxRate: number
  /** numero de filas de gasto del mes */
  count: number
  /** media por dia del mes */
  perDayJpy: number
}

export function toSecondary(jpy: number, fxRate: number): number {
  return jpy * fxRate
}

export function expensesOfMonth(data: AppData, monthId: string): Expense[] {
  return data.expenses.filter((e) => e.monthId === monthId)
}

/**
 * Un mes cuenta como "gasto real" si tiene al menos un apunte normal o
 * extraordinario. Ni un mes que solo se abrio de pasada (sin apuntar nada,
 * con el limite por defecto) ni uno de solo alquiler/fijos cuentan, aunque su
 * total sea mayor que cero: ver `recentActiveAverageJpy` para el porque.
 */
export function hasRealSpend(data: AppData, monthId: string): boolean {
  return expensesOfMonth(data, monthId).some((e) => e.kind === 'normal' || e.kind === 'extraordinary')
}

export function getMonth(data: AppData, monthId: string): MonthData | undefined {
  return data.months.find((m) => m.id === monthId)
}

/**
 * Calcula todos los indicadores de un mes.
 * Equivalencias con el Excel:
 *   A2 -> totalJpy     A3 -> totalJpy * fxRate
 *   A8 -> dailyLifeJpy A11 -> fixedJpy
 *   A17 -> otherJpy    A21 -> balanceJpy
 */
export function monthTotals(data: AppData, monthId: string): MonthTotals {
  const month = getMonth(data, monthId)
  const rentJpy = month?.rentJpy ?? 0
  const extrasJpy = sum((month?.extras ?? []).map((x) => x.amount))
  const fxRate = month?.fxRate ?? data.settings.defaultFxRate
  const limitJpy = month?.limitJpy ?? data.settings.defaultLimitJpy
  const incomeJpy = month?.incomeJpy ?? data.settings.defaultIncomeJpy

  const items = expensesOfMonth(data, monthId)
  // los apuntes "sin coste" (regalos, etc.) son solo informativos: no cuentan
  // en ningun total, tope de categoria ni ranking, aunque se listan igual
  const costItems = items.filter((e) => e.kind !== 'noCost')
  const noCostItemsOfMonth = items.filter((e) => e.kind === 'noCost')

  const byCategory: Record<string, number> = {}
  for (const c of data.categories) byCategory[c.id] = 0
  for (const e of costItems) {
    byCategory[e.categoryId] = (byCategory[e.categoryId] ?? 0) + e.amount
  }

  const dailyIds = new Set(data.categories.filter((c) => c.bucket === 'daily').map((c) => c.id))

  const itemsJpy = sum(costItems.map((e) => e.amount))
  const totalJpy = itemsJpy + rentJpy + extrasJpy
  const dailyLifeJpy = sum(costItems.filter((e) => dailyIds.has(e.categoryId)).map((e) => e.amount))
  const recurringJpy = sum(costItems.filter((e) => e.kind === 'recurring').map((e) => e.amount))
  const fixedJpy = recurringJpy + rentJpy + extrasJpy
  const extraordinaryJpy = sum(costItems.filter((e) => e.kind === 'extraordinary').map((e) => e.amount))
  const noCostJpy = sum(noCostItemsOfMonth.map((e) => e.amount))

  return {
    monthId,
    byCategory,
    itemsJpy,
    rentJpy,
    extrasJpy,
    totalJpy,
    dailyLifeJpy,
    fixedJpy,
    otherJpy: totalJpy - fixedJpy,
    extraordinaryJpy,
    noCostJpy,
    noCostCount: noCostItemsOfMonth.length,
    limitJpy,
    incomeJpy,
    balanceJpy: limitJpy - totalJpy,
    usedRatio: limitJpy > 0 ? totalJpy / limitJpy : 0,
    fxRate,
    count: costItems.length,
    perDayJpy: totalJpy / daysInMonth(monthId),
  }
}

/** Lo que costaria apuntar como deuda un mes que se paso de su limite. */
export interface OverspendDebt {
  monthId: string
  /** cuanto se paso, en yenes (siempre > 0) */
  amountJpy: number
  /** 'YYYY-MM-DD' del ultimo dia de ese mes */
  date: string
}

/**
 * Si un mes se paso de su limite, la deuda que generaria; null si no llego a
 * pasarse (o si ni siquiera tiene un mes creado). Pura: no toca Ahorros, solo
 * calcula cuanto y de que fecha seria.
 */
export function overspendDebt(data: AppData, monthId: string): OverspendDebt | null {
  if (!getMonth(data, monthId)) return null
  const t = monthTotals(data, monthId)
  const amountJpy = t.totalJpy - t.limitJpy
  if (amountJpy <= 0) return null
  return { monthId, amountJpy, date: `${monthId}-${String(daysInMonth(monthId)).padStart(2, '0')}` }
}

/* ------------------------------------------------------------------ *
 * Estadisticas entre meses
 * ------------------------------------------------------------------ */

/** Meses con datos (gastos, alquiler, extras o limite), ordenados. */
export function monthsWithData(data: AppData): string[] {
  const ids = new Set<string>()
  for (const e of data.expenses) ids.add(e.monthId)
  for (const m of data.months) {
    if (m.rentJpy || m.extras.length || m.limitJpy) ids.add(m.id)
  }
  return [...ids].filter(isValidMonthId).sort()
}

export interface StatsOptions {
  /** ultimos N meses; 0 o undefined = todos */
  lastMonths?: number
  /** excluir gastos marcados como extraordinarios */
  excludeExtraordinary?: boolean
  /** mes de referencia (por defecto el ultimo con datos) */
  upTo?: string
}

export interface MonthPoint {
  monthId: string
  totalJpy: number
  byCategory: Record<string, number>
  dailyLifeJpy: number
  fixedJpy: number
  otherJpy: number
  limitJpy: number
  perDayJpy: number
  fxRate: number
  count: number
}

export interface Stats {
  months: MonthPoint[]
  /** total del ultimo mes del rango */
  currentJpy: number
  previousJpy: number
  /** variacion relativa frente al mes anterior (0 si no hay anterior) */
  momRatio: number
  /** media, mediana y extremos solo cuentan meses con gasto real (ver `hasRealSpend`) */
  averageJpy: number
  medianJpy: number
  maxMonth?: MonthPoint
  minMonth?: MonthPoint
  /** cuantos de `months` contaron para averageJpy/medianJpy/min/maxMonth */
  activeMonthCount: number
  /** total por categoria en todo el rango */
  byCategory: Record<string, number>
  /** media mensual por categoria */
  avgByCategory: Record<string, number>
  totalJpy: number
  /** media de gasto por dia en todo el rango */
  perDayJpy: number
}

/**
 * Filtra los gastos segun las opciones y devuelve una copia de los datos.
 * Los apuntes "sin coste" se excluyen siempre: son informativos, no gasto real.
 */
function filtered(data: AppData, opts: StatsOptions): AppData {
  let expenses = data.expenses.filter((e) => e.kind !== 'noCost')
  if (opts.excludeExtraordinary) expenses = expenses.filter((e) => e.kind !== 'extraordinary')
  return expenses.length === data.expenses.length ? data : { ...data, expenses }
}

export function computeStats(data: AppData, opts: StatsOptions = {}): Stats {
  const src = filtered(data, opts)
  let ids = monthsWithData(src)
  if (opts.upTo) ids = ids.filter((id) => id <= opts.upTo!)
  if (opts.lastMonths && opts.lastMonths > 0) ids = ids.slice(-opts.lastMonths)

  const months: MonthPoint[] = ids.map((id) => {
    const t = monthTotals(src, id)
    return {
      monthId: id,
      totalJpy: t.totalJpy,
      byCategory: t.byCategory,
      dailyLifeJpy: t.dailyLifeJpy,
      fixedJpy: t.fixedJpy,
      otherJpy: t.otherJpy,
      limitJpy: t.limitJpy,
      perDayJpy: t.perDayJpy,
      fxRate: t.fxRate,
      count: t.count,
    }
  })

  const totals = months.map((m) => m.totalJpy)
  const current = months.at(-1)
  const previous = months.at(-2)

  // media, mediana y extremos solo cuentan meses con gasto real: si no, un
  // mes abierto de pasada o de solo alquiler/fijos (total bajo pero mayor que
  // cero) rebaja la media/mediana sin motivo y gana trivialmente "mes mas
  // barato" solo por no tener nada apuntado. El resto (meses, grafica, mes
  // actual/anterior) sigue mostrando el rango tal cual, sin recortar nada.
  const active = months.filter((m) => hasRealSpend(src, m.monthId))
  const activeTotals = active.map((m) => m.totalJpy)

  const byCategory: Record<string, number> = {}
  for (const c of src.categories) byCategory[c.id] = 0
  for (const m of months) {
    for (const [k, v] of Object.entries(m.byCategory)) byCategory[k] = (byCategory[k] ?? 0) + v
  }
  const avgByCategory: Record<string, number> = {}
  for (const [k, v] of Object.entries(byCategory)) {
    avgByCategory[k] = months.length ? v / months.length : 0
  }

  const totalJpy = sum(totals)
  const days = sum(ids.map(daysInMonth))

  return {
    months,
    currentJpy: current?.totalJpy ?? 0,
    previousJpy: previous?.totalJpy ?? 0,
    momRatio: previous && previous.totalJpy > 0 && current
      ? current.totalJpy / previous.totalJpy - 1
      : 0,
    averageJpy: activeTotals.length ? sum(activeTotals) / activeTotals.length : 0,
    medianJpy: median(activeTotals),
    maxMonth: active.length ? active.reduce((a, b) => (b.totalJpy > a.totalJpy ? b : a)) : undefined,
    minMonth: active.length ? active.reduce((a, b) => (b.totalJpy < a.totalJpy ? b : a)) : undefined,
    activeMonthCount: active.length,
    byCategory,
    avgByCategory,
    totalJpy,
    perDayJpy: days ? totalJpy / days : 0,
  }
}

/* ------------------------------------------------------------------ *
 * Comparacion con el ano anterior
 * ------------------------------------------------------------------ */

export interface YoyPoint {
  /** mes 1-12 */
  month: number
  /** 'YYYY-MM' del ano en curso */
  monthId: string
  currentJpy: number | null
  previousJpy: number | null
}

export interface Yoy {
  year: number
  points: YoyPoint[]
  currentTotal: number
  previousTotal: number
  /** variacion del total acumulado; 0 si el ano anterior no tiene datos */
  ratio: number
  /** meses con datos en los dos anos */
  comparable: number
}

/**
 * Serie de doce meses del ano de `monthId` frente al mismo mes del ano
 * anterior. Solo se comparan meses que existen en los dos anos, para que la
 * variacion no salga distorsionada por meses vacios.
 */
export function computeYoy(data: AppData, monthId: string, opts: StatsOptions = {}): Yoy {
  const src = filtered(data, opts)
  const year = Number(monthId.slice(0, 4))
  const have = new Set(monthsWithData(src))

  const points: YoyPoint[] = []
  let currentTotal = 0
  let previousTotal = 0
  let comparable = 0

  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0')
    const cur = `${year}-${mm}`
    const prev = `${year - 1}-${mm}`
    const currentJpy = have.has(cur) ? monthTotals(src, cur).totalJpy : null
    const previousJpy = have.has(prev) ? monthTotals(src, prev).totalJpy : null
    points.push({ month: m, monthId: cur, currentJpy, previousJpy })
    if (currentJpy !== null && previousJpy !== null) {
      currentTotal += currentJpy
      previousTotal += previousJpy
      comparable += 1
    }
  }

  return {
    year,
    points,
    currentTotal,
    previousTotal,
    ratio: previousTotal > 0 ? currentTotal / previousTotal - 1 : 0,
    comparable,
  }
}

/* ------------------------------------------------------------------ *
 * Rankings
 * ------------------------------------------------------------------ */

/** Normaliza el nombre de un comercio para poder agrupar ("Uber " y "uber"). */
export function normalizeLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?]+$/, '')
}

export interface LabelStat {
  label: string
  totalJpy: number
  count: number
  avgJpy: number
  categoryId: string
}

/** Ranking de comercios / conceptos por importe total. */
export function topLabels(
  data: AppData,
  opts: StatsOptions & { limit?: number; monthIds?: string[] } = {},
): LabelStat[] {
  const src = filtered(data, opts)
  const allow = opts.monthIds ? new Set(opts.monthIds) : null
  const map = new Map<string, LabelStat>()
  for (const e of src.expenses) {
    if (allow && !allow.has(e.monthId)) continue
    const key = normalizeLabel(e.label)
    if (!key) continue
    const cur = map.get(key)
    if (cur) {
      cur.totalJpy += e.amount
      cur.count += 1
      cur.avgJpy = cur.totalJpy / cur.count
    } else {
      map.set(key, {
        label: e.label.trim(),
        totalJpy: e.amount,
        count: 1,
        avgJpy: e.amount,
        categoryId: e.categoryId,
      })
    }
  }
  const out = [...map.values()].sort((a, b) => b.totalJpy - a.totalJpy)
  return opts.limit ? out.slice(0, opts.limit) : out
}

/** Gastos individuales mas grandes. */
export function topExpenses(
  data: AppData,
  opts: StatsOptions & { limit?: number; monthIds?: string[] } = {},
): Expense[] {
  const src = filtered(data, opts)
  const allow = opts.monthIds ? new Set(opts.monthIds) : null
  return src.expenses
    .filter((e) => !allow || allow.has(e.monthId))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, opts.limit ?? 10)
}

/** Apuntes marcados como "sin coste" (regalos, etc.): informativo, no es ranking de gasto. */
export function noCostItems(data: AppData, opts: { monthIds?: string[] } = {}): Expense[] {
  const allow = opts.monthIds ? new Set(opts.monthIds) : null
  return data.expenses
    .filter((e) => e.kind === 'noCost' && (!allow || allow.has(e.monthId)))
    .sort((a, b) => b.monthId.localeCompare(a.monthId) || b.amount - a.amount)
}

/* ------------------------------------------------------------------ *
 * Ritmo de gasto dentro del mes
 * ------------------------------------------------------------------ */

export interface BurnPoint {
  day: number
  cumulativeJpy: number
  paceJpy: number
}

/**
 * Gasto acumulado por dia frente al ritmo ideal (limite repartido
 * linealmente). Solo tiene sentido si hay gastos con dia asignado.
 */
export function monthBurn(data: AppData, monthId: string): BurnPoint[] {
  const t = monthTotals(data, monthId)
  const nDays = daysInMonth(monthId)
  const items = expensesOfMonth(data, monthId)
  const perDay = new Array(nDays + 1).fill(0) as number[]
  // los gastos sin dia y los fijos se reparten en el dia 1
  let unassigned = t.rentJpy + t.extrasJpy
  for (const e of items) {
    if (e.day && e.day >= 1 && e.day <= nDays) perDay[e.day] += e.amount
    else unassigned += e.amount
  }
  perDay[1] += unassigned
  const out: BurnPoint[] = []
  let acc = 0
  for (let d = 1; d <= nDays; d++) {
    acc += perDay[d]
    out.push({ day: d, cumulativeJpy: acc, paceJpy: (t.limitJpy * d) / nDays })
  }
  return out
}

/** Cuantos gastos del mes tienen dia asignado. */
export function datedCount(data: AppData, monthId: string): number {
  return expensesOfMonth(data, monthId).filter((e) => !!e.day).length
}

/**
 * Proyeccion de cierre del mes en curso: lo gastado hasta hoy extrapolado
 * al total de dias. Si el mes no es el actual devuelve el total real.
 */
export function projectMonth(data: AppData, monthId: string, today = new Date()): number {
  const t = monthTotals(data, monthId)
  const currentId = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  if (monthId !== currentId) return t.totalJpy
  const nDays = daysInMonth(monthId)
  const elapsed = Math.min(today.getDate(), nDays)
  if (elapsed === 0) return t.totalJpy
  return (t.totalJpy / elapsed) * nDays
}

/* ------------------------------------------------------------------ *
 * Ahorros / patrimonio
 * ------------------------------------------------------------------ */

/** Convierte el saldo de una cuenta a yenes usando el tipo de cambio dado. */
export function accountToJpy(amount: number, currency: string, fxRate: number): number {
  if (currency === 'JPY') return amount
  // fxRate es JPY -> moneda secundaria, asi que invertimos
  return fxRate > 0 ? amount / fxRate : 0
}

export interface SnapshotTotals {
  id: string
  date: string
  assetsJpy: number
  debtsJpy: number
  netJpy: number
}

export function snapshotTotals(s: Snapshot, fxRate: number): SnapshotTotals {
  let assets = 0
  let debts = 0
  for (const a of s.accounts) {
    const jpy = accountToJpy(a.amount, a.currency, fxRate)
    if (a.isDebt) debts += jpy
    else assets += jpy
  }
  return { id: s.id, date: s.date, assetsJpy: assets, debtsJpy: debts, netJpy: assets - debts }
}

export function snapshotSeries(data: AppData): SnapshotTotals[] {
  return [...data.snapshots]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => snapshotTotals(s, data.settings.defaultFxRate))
}

/**
 * Suma los topes de categoria (0 para las que no tienen o estan archivadas):
 * el gasto que se daria si cada categoria llegara justo a su limite.
 */
export function categoryLimitsJpy(categories: Category[]): number {
  return sum(categories.filter((c) => !c.archived).map((c) => c.limitJpy ?? 0))
}

/** Patrimonio proyectado a un plazo, en tres escenarios. */
export interface SavingsHorizon {
  months: number
  /** gastando hasta el limite total del mes (el escenario mas simple) */
  worstCaseJpy: number
  /**
   * gastando hasta el tope de cada categoria (las que no tienen tope cuentan
   * como gasto cero) mas alquiler y extras: otro "peor caso", mas fino
   */
  worstCaseByCategoryJpy: number
  /**
   * al ritmo real de los ultimos meses (ver `lastMonths`); null si todavia no
   * hay ningun mes con gasto real del que sacar una media de verdad
   */
  realisticJpy: number | null
}

/**
 * Media de gasto real de los ultimos `lastMonths` meses con datos, para el
 * escenario "realista" de la prevision de ahorro. Devuelve null si no hay
 * ningun mes que cuente como gasto real (ver abajo): es mejor decir
 * abiertamente que falta historial que inventar un numero con lo que haya.
 *
 * Dos tipos de mes no cuentan como "gasto real", aunque tengan un total
 * mayor que cero:
 *   - un mes que solo se abrio de pasada -sin apuntar nada, con el limite y
 *     el alquiler que trae por defecto- cuenta como "mes con datos" en
 *     `monthsWithData` (por el limite), pero no es gasto real;
 *   - un mes que solo tiene alquiler y gastos recurrentes (copiados solos del
 *     mes anterior) pero ni un apunte del dia a dia: el alquiler es real,
 *     pero falta toda la parte variable, asi que su total no representa un
 *     mes completo.
 * Meter cualquiera de los dos en la media la rebajaria de forma artificial y
 * el ahorro previsto saldria demasiado optimista. Por eso solo se cuentan los
 * meses con al menos un apunte normal o extraordinario, y se deja fuera el
 * mes en curso porque esta a medias (compararlo con meses completos tambien
 * rebaja la media sin motivo).
 *
 * Antes, si no quedaba ningun mes "activo", se volvia a la media sin filtrar
 * -la misma que mezcla meses en blanco y de solo-fijos- colando el problema
 * por la puerta de atras. Ahora, sin meses activos, no hay media que dar.
 */
export function recentActiveAverageJpy(data: AppData, lastMonths = 6, today = new Date()): number | null {
  const currentId = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const stats = computeStats(data, { lastMonths })
  const active = stats.months.filter((m) => m.monthId !== currentId && hasRealSpend(data, m.monthId))
  if (!active.length) return null
  return sum(active.map((m) => m.totalJpy)) / active.length
}

/**
 * Proyecta el patrimonio neto unos meses hacia delante desde la ultima foto
 * de ahorros, sumando cada mes el ahorro previsto: ingresos por defecto menos
 * gasto. Tres escenarios porque uno solo no cuenta la historia completa:
 *   - "peor caso, limite total": se gasta hasta el limite del mes (siempre
 *     hay uno, porque cae al de Ajustes si no se pone).
 *   - "peor caso, por categoria": se gasta hasta el tope de cada categoria
 *     (mas alquiler y los extras fijos por defecto); las categorias sin tope
 *     cuentan como gasto cero en ellas, no como "sin limite".
 *   - "realista": al ritmo real de los ultimos `lastMonths` meses con gasto
 *     de verdad (ver `recentActiveAverageJpy`).
 *
 * Como es una proyeccion a futuro (meses que ni existen todavia), los dos
 * peores casos usan los valores por defecto de Ajustes, no los de un mes
 * concreto.
 *
 * Devuelve [] si todavia no hay ninguna foto de ahorros de la que partir, o
 * si no hay ingresos previstos configurados (sin eso no hay nada que
 * proyectar, solo ruido).
 */
export function projectSavings(
  data: AppData,
  horizons: number[],
  lastMonths = 6,
  today = new Date(),
): SavingsHorizon[] {
  const income = data.settings.defaultIncomeJpy
  const last = snapshotSeries(data).at(-1)
  if (!last || income <= 0) return []

  const worstCaseDelta = income - data.settings.defaultLimitJpy
  const byCategorySpend =
    categoryLimitsJpy(data.categories) +
    data.settings.defaultRentJpy +
    sum(data.settings.defaultExtras.map((x) => x.amount))
  const worstCaseByCategoryDelta = income - byCategorySpend
  const recentAverage = recentActiveAverageJpy(data, lastMonths, today)
  const realisticDelta = recentAverage === null ? null : income - recentAverage

  return horizons.map((months) => ({
    months,
    worstCaseJpy: last.netJpy + worstCaseDelta * months,
    worstCaseByCategoryJpy: last.netJpy + worstCaseByCategoryDelta * months,
    realisticJpy: realisticDelta === null ? null : last.netJpy + realisticDelta * months,
  }))
}

/* ------------------------------------------------------------------ *
 * Ayudas de presentacion
 * ------------------------------------------------------------------ */

export function categoryById(cats: Category[], id: string): Category | undefined {
  return cats.find((c) => c.id === id)
}

export function activeCategories(cats: Category[]): Category[] {
  return cats.filter((c) => !c.archived)
}
