import type { Account, AppData, Category, Expense, Lang, MonthData, Snapshot } from './types'

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
  /** 一日生活の消費 = categorias del bucket "daily" */
  dailyLifeJpy: number
  /** gastos marcados como recurrentes (puede ser negativo: abonos fijos) */
  recurringJpy: number
  /** 毎月ある消費 = gastos marcados como recurrentes + alquiler + extras */
  fixedJpy: number
  /** 別の消費 = filas de categorias del bucket "other" que no son recurrentes */
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

/** 'YYYY-MM' de una fecha (el mismo calculo que `monthIdOf` en defaults.ts). */
function monthIdOfDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Ingresos previstos de un mes: los suyos si los tiene puestos, y si no los
 * de Ajustes. Un `incomeJpy` a 0 cuenta como "sin poner", igual que el 0 de
 * `defaultIncomeJpy` (ver DEFAULT_SETTINGS): asi un mes creado antes de
 * configurar los ingresos no se queda con un 0 pegado que apague la
 * prevision de ahorro para siempre.
 */
export function monthIncomeJpy(data: AppData, monthId: string): number {
  const own = getMonth(data, monthId)?.incomeJpy
  return typeof own === 'number' && own > 0 ? own : (data.settings.defaultIncomeJpy ?? 0)
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
  const incomeJpy = monthIncomeJpy(data, monthId)

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
  // "otros" es lo que promete su pie de tarjeta (ocio, ropa, casa...): las
  // filas del bucket que no es vida diaria y que no son recurrentes -esas ya
  // cuentan en los fijos-. Antes era total - fijos, que ademas de la comida
  // se tragaba cualquier abono recurrente en negativo (lo inflaba en vez de
  // descontarlo, porque restar un fijo mas pequeno da un "otros" mas grande)
  const otherJpy = sum(
    costItems.filter((e) => e.kind !== 'recurring' && !dailyIds.has(e.categoryId)).map((e) => e.amount),
  )
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
    recurringJpy,
    fixedJpy,
    otherJpy,
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
 * Salud del mes: cuanto se ahorra y cuanto se va solo
 * ------------------------------------------------------------------ */

/**
 * Tasa de ahorro del mes: (ingresos - gasto) / ingresos. Un 0,25 quiere
 * decir que de cada 100 ¥ que entran se quedan 25.
 *
 * Devuelve null si el mes no tiene ingresos de los que partir (ni suyos ni
 * por defecto): sin denominador no hay tasa, y un 0 se leeria como "no
 * ahorras nada" en vez de "falta el dato". Puede salir negativa: es
 * justamente el mes en que se gasto mas de lo que entro.
 */
export function savingsRate(data: AppData, monthId: string): number | null {
  const income = monthIncomeJpy(data, monthId)
  if (income <= 0) return null
  return (income - monthTotals(data, monthId).totalJpy) / income
}

/**
 * "Fuga": el gasto del mes que se va sin volver a decidirlo, o sea los
 * apuntes marcados como recurrentes (suscripciones, movil, seguros...).
 *
 * A proposito NO incluye el alquiler ni los extras fijos del mes: esos ya se
 * ven juntos en "Gastos fijos" de la pestana Mes, se deciden una vez y no
 * son de los que se acumulan sin darse cuenta. Puede salir negativa si hay
 * algun abono recurrente apuntado en negativo.
 */
export function leakJpy(data: AppData, monthId: string): number {
  return sum(
    expensesOfMonth(data, monthId)
      .filter((e) => e.kind === 'recurring')
      .map((e) => e.amount),
  )
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
  /** "hoy", para no contar meses futuros (ver computeStats). Solo hace falta pasarlo en pruebas. */
  today?: Date
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
  const today = opts.today ?? new Date()
  const currentId = monthIdOfDate(today)
  // los meses futuros al de hoy no cuentan: son huecos que deja `ensureMonth`
  // al navegar hacia delante (heredan alquiler y fijos, pero ningun gasto
  // real todavia). Sin este corte, unos pocos clics en "mes siguiente"
  // desplazan "los ultimos N meses" hacia el futuro en vez de coger los
  // ultimos meses de verdad vividos, y la media/mediana/colchon salen vacios
  // aunque haya historial real reciente.
  let ids = monthsWithData(src).filter((id) => id <= currentId)
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
  const currentId = monthIdOfDate(today)
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

/**
 * Ultimo mes ya cerrado del que fiarse para las cifras de "como va el mes":
 * el mas reciente anterior al de hoy con gasto real (ver `hasRealSpend`) y,
 * si ninguno lo tiene, el ultimo mes con datos anterior a hoy. Devuelve null
 * si no hay ninguno.
 *
 * El mes en curso queda fuera a proposito: esta a medias, asi que su tasa de
 * ahorro saldria inmejorable a principios de mes y ruinosa a finales, sin que
 * ninguna de las dos diga nada.
 */
export function lastClosedMonthId(data: AppData, today = new Date()): string | null {
  const currentId = monthIdOfDate(today)
  const ids = monthsWithData(data).filter((id) => id < currentId)
  if (!ids.length) return null
  const active = ids.filter((id) => hasRealSpend(data, id))
  return (active.length ? active : ids).at(-1) ?? null
}

/**
 * Cuentas marcadas como deuda en la ultima foto de ahorros: lo que se debe
 * hoy. Las fotos anteriores son historial, no saldo actual.
 */
export function debtAccounts(data: AppData): Account[] {
  const last = [...data.snapshots].sort((a, b) => a.date.localeCompare(b.date)).at(-1)
  return (last?.accounts ?? []).filter((a) => a.isDebt)
}

/** Suma en yenes de las cuentas marcadas como deuda (ver `debtAccounts`). */
export function debtTotalJpy(data: AppData): number {
  const fx = data.settings.defaultFxRate
  return sum(debtAccounts(data).map((a) => accountToJpy(a.amount, a.currency, fx)))
}

/**
 * Meses de colchon: cuantos meses se aguantaria solo con los activos
 * liquidos de la ultima foto, al ritmo de gasto medio de los ultimos
 * `lastMonths` meses activos (ver `recentActiveAverageJpy`).
 *
 * Cuenta los activos, no el patrimonio neto: las deudas no se pueden gastar
 * en vivir, asi que restarlas contestaria otra pregunta ("cuanto me queda si
 * salto todo"), no esta.
 *
 * Devuelve null si no hay ninguna foto o si todavia no hay historial de
 * gasto real: mejor eso que un 0 que se leeria como "sin colchon".
 */
export function monthsOfRunway(data: AppData, today = new Date(), lastMonths = 6): number | null {
  const last = snapshotSeries(data).at(-1)
  const average = recentActiveAverageJpy(data, lastMonths, today)
  if (!last || average === null || average <= 0) return null
  return last.assetsJpy / average
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
 * Ademas, `computeStats` ya deja fuera los meses posteriores a `today`: sin
 * eso, unos clics de mas en "mes siguiente" (que crean meses en blanco por
 * delante, heredando alquiler y fijos) desplazarian la ventana de "ultimos N
 * meses" hacia ese futuro vacio en vez del pasado reciente con gasto de
 * verdad.
 *
 * Antes, si no quedaba ningun mes "activo", se volvia a la media sin filtrar
 * -la misma que mezcla meses en blanco y de solo-fijos- colando el problema
 * por la puerta de atras. Ahora, sin meses activos, no hay media que dar.
 */
export function recentActiveAverageJpy(data: AppData, lastMonths = 6, today = new Date()): number | null {
  const currentId = monthIdOfDate(today)
  const stats = computeStats(data, { lastMonths, today })
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
  // los ingresos del mes en curso si los tiene puestos, y si no los de
  // Ajustes (ver `monthIncomeJpy`): antes solo miraba los de Ajustes, asi que
  // cambiar el ingreso de un mes no movia la prevision ni un yen
  const income = monthIncomeJpy(data, monthIdOfDate(today))
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
 * Prevision: bandas, meta y comprobacion
 * ------------------------------------------------------------------ */

/** Percentil de una lista YA ordenada, interpolando entre los dos vecinos. */
function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/**
 * Los meses que valen para prever: ya cerrados (nunca el de hoy, que esta a
 * medias) y con gasto real (ver `hasRealSpend`), del mas viejo al mas nuevo.
 * `lastMonths` a 0 los coge todos.
 */
function closedActiveMonths(data: AppData, today: Date, lastMonths = 0): MonthPoint[] {
  const currentId = monthIdOfDate(today)
  return computeStats(data, { lastMonths, today }).months.filter(
    (m) => m.monthId !== currentId && hasRealSpend(data, m.monthId),
  )
}

export interface BurnPercentiles {
  /** un mes barato de los tuyos */
  p25: number
  /** el mes tipico (mediana) */
  p50: number
  /** un mes caro de los tuyos */
  p75: number
  /** cuantos meses cerrados con actividad han entrado en la cuenta */
  monthCount: number
}

/**
 * Reparto del gasto mensual de los ultimos `lastMonths` meses cerrados con
 * actividad: el mes barato (p25), el tipico (p50) y el caro (p75).
 *
 * La media sola no dice nada de la variacion, y es justo la variacion la que
 * decide si una prevision es fiable o un numero bonito. Devuelve null si no
 * hay ni un mes del que fiarse.
 */
export function percentiles(data: AppData, lastMonths = 12, today = new Date()): BurnPercentiles | null {
  const totals = closedActiveMonths(data, today, lastMonths).map((m) => m.totalJpy)
  if (!totals.length) return null
  const sorted = [...totals].sort((a, b) => a - b)
  return {
    p25: quantile(sorted, 0.25),
    p50: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    monthCount: sorted.length,
  }
}

export interface NetWorthMonth {
  monthId: string
  netJpy: number
  assetsJpy: number
}

/**
 * Patrimonio real mes a mes, desde la primera foto hasta el mes de hoy: en
 * cada mes, la ultima foto hecha hasta ese mes (si un mes no tiene foto se
 * arrastra la anterior, que es lo que se sabia entonces).
 *
 * Hace falta para dibujar historico y prevision en el mismo eje de meses:
 * `snapshotSeries` va por fecha de foto, que no cae igual en cada mes.
 */
export function netWorthMonthly(data: AppData, today = new Date()): NetWorthMonth[] {
  const series = snapshotSeries(data)
  if (!series.length) return []
  const from = series[0].date.slice(0, 7)
  const to = monthIdOfDate(today)
  if (to < from) return []

  const out: NetWorthMonth[] = []
  let i = 0
  let last = series[0]
  for (const monthId of monthRange(from, to)) {
    while (i < series.length && series[i].date.slice(0, 7) <= monthId) {
      last = series[i]
      i++
    }
    out.push({ monthId, netJpy: last.netJpy, assetsJpy: last.assetsJpy })
  }
  return out
}

export interface SavingsBandPoint {
  /** 'YYYY-MM' proyectado */
  monthId: string
  /** meses desde hoy (1, 2, 3...) */
  months: number
  /** gastando como en un mes barato (p25): el borde de arriba de la banda */
  highJpy: number
  /** gastando como en un mes tipico (p50) */
  medianJpy: number
  /** gastando como en un mes caro (p75): el borde de abajo */
  lowJpy: number
}

/**
 * Patrimonio proyectado mes a mes desde la ultima foto, con banda: cada mes
 * suma los ingresos menos el gasto del percentil correspondiente. El gasto
 * bajo (p25) da el borde de arriba y el alto (p75) el de abajo, porque
 * gastar menos deja mas patrimonio.
 *
 * A diferencia de `projectSavings` (tres escenarios sueltos a plazos
 * concretos), esto es la serie continua que se dibuja: por eso devuelve un
 * punto por mes. Devuelve [] si falta cualquiera de las tres patas: foto de
 * la que partir, ingresos previstos o historial de gasto.
 */
export function projectSavingsBands(
  data: AppData,
  horizonMonths = 24,
  lastMonths = 12,
  today = new Date(),
): SavingsBandPoint[] {
  const p = percentiles(data, lastMonths, today)
  const last = snapshotSeries(data).at(-1)
  const income = monthIncomeJpy(data, monthIdOfDate(today))
  if (!p || !last || income <= 0 || horizonMonths <= 0) return []

  const from = monthIdOfDate(today)
  const out: SavingsBandPoint[] = []
  for (let k = 1; k <= horizonMonths; k++) {
    out.push({
      monthId: shiftMonth(from, k),
      months: k,
      highJpy: last.netJpy + (income - p.p25) * k,
      medianJpy: last.netJpy + (income - p.p50) * k,
      lowJpy: last.netJpy + (income - p.p75) * k,
    })
  }
  return out
}

/**
 * Une las series de patrimonio de varios documentos (yo y mi pareja) en una
 * sola, mes a mes: en cada mes suma el ultimo valor conocido de cada lado,
 * igual que hace `combinedSnapshotSeries` con las fotas sueltas. Un lado que
 * todavia no habia empezado no suma nada, en vez de romper la serie.
 */
export function mergeNetWorthMonthly(sides: NetWorthMonth[][]): NetWorthMonth[] {
  const withData = sides.filter((s) => s.length)
  if (withData.length <= 1) return withData[0] ?? []

  const from = withData.map((s) => s[0].monthId).sort()[0]
  const to = withData.map((s) => s[s.length - 1].monthId).sort().at(-1)!
  return monthRange(from, to).map((monthId) => {
    let netJpy = 0
    let assetsJpy = 0
    for (const side of withData) {
      let known: NetWorthMonth | undefined
      for (const p of side) {
        if (p.monthId > monthId) break
        known = p
      }
      if (known) {
        netJpy += known.netJpy
        assetsJpy += known.assetsJpy
      }
    }
    return { monthId, netJpy, assetsJpy }
  })
}

/**
 * Suma banda con banda las previsiones de varios documentos, mes a mes: el
 * mismo criterio que `combinedProjectSavings`, que tambien suma escenario a
 * escenario en vez de rehacer el calculo con los dos juntos.
 */
export function mergeSavingsBands(sides: SavingsBandPoint[][]): SavingsBandPoint[] {
  const withData = sides.filter((s) => s.length)
  if (withData.length <= 1) return withData[0] ?? []

  const byMonth = new Map<string, SavingsBandPoint>()
  for (const side of withData) {
    for (const p of side) {
      const cur = byMonth.get(p.monthId)
      if (cur) {
        cur.highJpy += p.highJpy
        cur.medianJpy += p.medianJpy
        cur.lowJpy += p.lowJpy
      } else byMonth.set(p.monthId, { ...p })
    }
  }
  return [...byMonth.values()].sort((a, b) => a.monthId.localeCompare(b.monthId))
}

/**
 * Suma los percentiles de varios documentos, para que la nota de "un mes
 * barato / tipico / caro" de la vista "Juntos" cuadre con la banda que se
 * dibuja (que tambien es la suma de las dos). Si a algun lado le falta
 * historial no hay suma que valga: devuelve null.
 */
export function sumPercentiles(sides: (BurnPercentiles | null)[]): BurnPercentiles | null {
  if (!sides.length || sides.some((p) => p === null)) return null
  const ok = sides as BurnPercentiles[]
  return {
    p25: sum(ok.map((p) => p.p25)),
    p50: sum(ok.map((p) => p.p50)),
    p75: sum(ok.map((p) => p.p75)),
    monthCount: Math.min(...ok.map((p) => p.monthCount)),
  }
}

export interface SavingsGoalStatus {
  /** patrimonio que se quiere tener */
  targetJpy: number
  /** en cuantos meses */
  months: number
  /** 'YYYY-MM' en que se cumple el plazo */
  dueMonthId: string
  /** patrimonio de partida (ultima foto) */
  startJpy: number
  /** lo que falta (0 si ya se llego) */
  missingJpy: number
  /** cuanto habria que ahorrar cada mes para llegar a tiempo */
  requiredMonthlyJpy: number
  /** ahorro mensual al ritmo tipico (ingresos - gasto p50); null sin historial */
  medianMonthlyJpy: number | null
  /** 'YYYY-MM' en que se llegaria a ese ritmo; null si no se sabe o no se llega */
  etaMonthId: string | null
  /** si se llega a tiempo; null cuando no hay con que saberlo */
  onTrack: boolean | null
}

/**
 * La meta: "de aqui a X meses quiero tener Y". Traduce esos dos numeros de
 * Ajustes a lo unico que se puede hacer con ellos: cuanto falta, cuanto hay
 * que ahorrar al mes para llegar y cuando se llegaria al ritmo de siempre.
 *
 * Devuelve null si no hay meta puesta o no hay ninguna foto de la que partir.
 */
export function savingsGoal(data: AppData, today = new Date(), lastMonths = 12): SavingsGoalStatus | null {
  const targetJpy = data.settings.savingsGoalJpy ?? 0
  const months = data.settings.savingsGoalMonths ?? 0
  const last = snapshotSeries(data).at(-1)
  if (targetJpy <= 0 || months <= 0 || !last) return null

  const startJpy = last.netJpy
  const missingJpy = Math.max(0, targetJpy - startJpy)
  const currentId = monthIdOfDate(today)
  const p = percentiles(data, lastMonths, today)
  const income = monthIncomeJpy(data, currentId)
  const medianMonthlyJpy = p && income > 0 ? income - p.p50 : null

  let etaMonthId: string | null = null
  let onTrack: boolean | null = null
  if (missingJpy === 0) {
    etaMonthId = currentId
    onTrack = true
  } else if (medianMonthlyJpy !== null) {
    const needed = medianMonthlyJpy > 0 ? Math.ceil(missingJpy / medianMonthlyJpy) : Infinity
    // mas de diez anos es lo mismo que "asi no se llega": dar una fecha de
    // 2049 seria fingir una precision que esta cuenta no tiene
    etaMonthId = needed <= 120 ? shiftMonth(currentId, needed) : null
    onTrack = needed <= months
  }

  return {
    targetJpy,
    months,
    dueMonthId: shiftMonth(currentId, months),
    startJpy,
    missingJpy,
    requiredMonthlyJpy: missingJpy / months,
    medianMonthlyJpy,
    etaMonthId,
    onTrack,
  }
}

export interface ForecastBacktest {
  /** ultimo mes que uso el modelo para aprender */
  cutMonthId: string
  /** cuantos meses aprendio */
  trainMonthCount: number
  /** los meses con los que se le ha tomado la leccion */
  testMonthIds: string[]
  /** lo que el modelo habria previsto que se gastaria en ellos */
  predictedJpy: number
  /** lo que se gasto de verdad */
  actualJpy: number
  /** (previsto - real) / real: positivo = se quedo corto de gasto (optimista) */
  errorRatio: number
  /** cuantos de esos meses cayeron dentro de la banda p25-p75 */
  insideBand: number
}

/**
 * Comprobacion honesta de la prevision: corta el historial por un punto
 * pasado, calcula la mediana solo con lo anterior al corte -sin ver el
 * futuro- y la compara con lo que paso de verdad despues.
 *
 * Se comprueba el gasto, no el patrimonio, porque el gasto es lo unico que
 * el modelo adivina: los ingresos se dan por sabidos y la foto de partida
 * es un dato.
 *
 * Devuelve null si no hay historial para partirlo en dos (hacen falta al
 * menos cuatro meses cerrados con actividad): con menos, el resultado diria
 * mas del azar que del modelo.
 */
export function backtestForecast(
  data: AppData,
  testMonths = 3,
  today = new Date(),
): ForecastBacktest | null {
  const active = closedActiveMonths(data, today)
  if (active.length < 4) return null

  const testCount = Math.max(1, Math.min(testMonths, Math.floor(active.length / 2)))
  const train = active.slice(0, active.length - testCount)
  const test = active.slice(active.length - testCount)

  const sorted = train.map((m) => m.totalJpy).sort((a, b) => a - b)
  const p25 = quantile(sorted, 0.25)
  const p50 = quantile(sorted, 0.5)
  const p75 = quantile(sorted, 0.75)

  const predictedJpy = p50 * test.length
  const actualJpy = sum(test.map((m) => m.totalJpy))

  return {
    cutMonthId: train[train.length - 1].monthId,
    trainMonthCount: train.length,
    testMonthIds: test.map((m) => m.monthId),
    predictedJpy,
    actualJpy,
    errorRatio: actualJpy > 0 ? (predictedJpy - actualJpy) / actualJpy : 0,
    insideBand: test.filter((m) => m.totalJpy >= p25 && m.totalJpy <= p75).length,
  }
}

export interface UpcomingGroup {
  monthId: string
  items: Expense[]
  totalJpy: number
}

export interface Upcoming {
  groups: UpcomingGroup[]
  totalJpy: number
  count: number
}

/**
 * Lo que ya esta apuntado con fecha posterior a hoy: los meses de mas
 * adelante enteros, y del mes en curso solo los apuntes con dia posterior al
 * de hoy. No es prevision, es cosa sabida, y por eso va aparte.
 *
 * Los apuntes "sin coste" se quedan fuera, como en el resto de totales.
 */
export function upcomingExpenses(data: AppData, today = new Date()): Upcoming {
  const currentId = monthIdOfDate(today)
  const day = today.getDate()
  const items = data.expenses.filter(
    (e) =>
      e.kind !== 'noCost' &&
      isValidMonthId(e.monthId) &&
      (e.monthId > currentId || (e.monthId === currentId && !!e.day && e.day > day)),
  )

  const byMonth = new Map<string, Expense[]>()
  for (const e of items) {
    const list = byMonth.get(e.monthId)
    if (list) list.push(e)
    else byMonth.set(e.monthId, [e])
  }

  const groups: UpcomingGroup[] = [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([monthId, list]) => ({
      monthId,
      items: [...list].sort((a, b) => (a.day ?? 99) - (b.day ?? 99) || b.amount - a.amount),
      totalJpy: sum(list.map((e) => e.amount)),
    }))

  return { groups, totalJpy: sum(groups.map((g) => g.totalJpy)), count: items.length }
}

/* ------------------------------------------------------------------ *
 * Estadisticas: tasa de ahorro, fijos y ticket por trimestre
 * ------------------------------------------------------------------ */

export interface SavingsRatePoint {
  monthId: string
  incomeJpy: number
  spentJpy: number
  /** (ingresos - gasto) / ingresos; null si ese mes no tiene ingresos */
  rate: number | null
  /** el mes en curso, que esta a medias y no se puede comparar con los cerrados */
  inProgress: boolean
  /** tasa que saldria si el mes acabara al ritmo que lleva; solo el mes en curso */
  projectedRate: number | null
}

/**
 * Tasa de ahorro mes a mes, para dibujarla en barras. El mes en curso viene
 * marcado (`inProgress`) y con su proyeccion a cierre aparte: mezclarlo con
 * los cerrados haria creer que se ahorra muchisimo el dia 3.
 */
export function savingsRateSeries(
  data: AppData,
  monthIds: string[],
  today = new Date(),
): SavingsRatePoint[] {
  const currentId = monthIdOfDate(today)
  return monthIds.map((monthId) => {
    const incomeJpy = monthIncomeJpy(data, monthId)
    const spentJpy = monthTotals(data, monthId).totalJpy
    const inProgress = monthId === currentId
    const projected = inProgress ? projectMonth(data, monthId, today) : 0
    return {
      monthId,
      incomeJpy,
      spentJpy,
      rate: incomeJpy > 0 ? (incomeJpy - spentJpy) / incomeJpy : null,
      inProgress,
      projectedRate: inProgress && incomeJpy > 0 ? (incomeJpy - projected) / incomeJpy : null,
    }
  })
}

/**
 * Junta las tasas de ahorro de varios documentos: suma ingresos y gastos de
 * cada mes y rehace la division. Sumar las tasas de cada uno no valdria -una
 * tasa es un cociente, no un importe-.
 */
export function mergeSavingsRateSeries(sides: SavingsRatePoint[][]): SavingsRatePoint[] {
  const withData = sides.filter((s) => s.length)
  if (withData.length <= 1) return withData[0] ?? []

  const byMonth = new Map<string, SavingsRatePoint>()
  for (const side of withData) {
    for (const p of side) {
      const cur = byMonth.get(p.monthId)
      if (!cur) {
        byMonth.set(p.monthId, { ...p })
        continue
      }
      cur.incomeJpy += p.incomeJpy
      cur.spentJpy += p.spentJpy
      cur.inProgress = cur.inProgress || p.inProgress
    }
  }
  // la proyeccion del mes en curso se rehace con los totales ya sumados
  const projectedSpend = new Map<string, number>()
  for (const side of withData) {
    for (const p of side) {
      if (!p.inProgress || p.projectedRate === null) continue
      projectedSpend.set(
        p.monthId,
        (projectedSpend.get(p.monthId) ?? 0) + p.incomeJpy * (1 - p.projectedRate),
      )
    }
  }
  return [...byMonth.values()]
    .sort((a, b) => a.monthId.localeCompare(b.monthId))
    .map((p) => ({
      ...p,
      rate: p.incomeJpy > 0 ? (p.incomeJpy - p.spentJpy) / p.incomeJpy : null,
      projectedRate:
        p.inProgress && p.incomeJpy > 0 && projectedSpend.has(p.monthId)
          ? (p.incomeJpy - projectedSpend.get(p.monthId)!) / p.incomeJpy
          : null,
    }))
}

/** Cuantos meses hay entre dos 'YYYY-MM' (0 si son el mismo). */
export function monthsBetween(from: string, to: string): number {
  return from <= to ? monthRange(from, to).length - 1 : 0
}

export interface RecurringItem {
  label: string
  categoryId: string
  /** lo que costo la ultima vez */
  amountJpy: number
  /** lo que costaba antes de ese ultimo cambio de precio; null si nunca cambio */
  previousAmountJpy: number | null
  /** variacion del ultimo cambio de precio; null si nunca cambio */
  changeRatio: number | null
  /** ha subido de precio */
  raised: boolean
  /** en cuantos meses distintos aparece */
  monthCount: number
  firstMonthId: string
  lastMonthId: string
  /** cada cuantos meses aparece de media; null si solo aparecio una vez */
  everyMonths: number | null
  /** lo que costara al ano si sigue apareciendo igual de a menudo */
  yearlyJpy: number
  /** lo que llevas pagado en el periodo mirado */
  totalJpy: number
}

/**
 * Los fijos y las suscripciones: los apuntes marcados como recurrentes,
 * agrupados por concepto (normalizado, ver `normalizeLabel`), con cada
 * cuanto aparecen, lo que costarian al ano y si han subido de precio.
 *
 * Lo interesante aqui no es el total del mes -eso ya esta en "Gastos fijos"-
 * sino el goteo: cada cuanto vuelve y si algun dia subio sin avisar.
 */
export function recurringItems(data: AppData, opts: { monthIds?: string[] } = {}): RecurringItem[] {
  const allow = opts.monthIds ? new Set(opts.monthIds) : null
  const groups = new Map<string, { label: string; categoryId: string; byMonth: Map<string, number> }>()

  for (const e of data.expenses) {
    if (e.kind !== 'recurring') continue
    if (allow && !allow.has(e.monthId)) continue
    if (!isValidMonthId(e.monthId)) continue
    const key = normalizeLabel(e.label)
    if (!key) continue
    const g = groups.get(key) ?? { label: e.label.trim(), categoryId: e.categoryId, byMonth: new Map() }
    // varios apuntes del mismo concepto en un mes cuentan como uno solo
    g.byMonth.set(e.monthId, (g.byMonth.get(e.monthId) ?? 0) + e.amount)
    groups.set(key, g)
  }

  const out: RecurringItem[] = []
  for (const g of groups.values()) {
    const months = [...g.byMonth.keys()].sort()
    const amounts = months.map((m) => g.byMonth.get(m)!)
    const amountJpy = amounts[amounts.length - 1]
    // el ultimo importe distinto del actual: con eso se ve si subio o bajo
    let previousAmountJpy: number | null = null
    for (let i = amounts.length - 2; i >= 0; i--) {
      if (amounts[i] !== amountJpy) {
        previousAmountJpy = amounts[i]
        break
      }
    }
    const changeRatio =
      previousAmountJpy !== null && previousAmountJpy !== 0
        ? amountJpy / previousAmountJpy - 1
        : null
    const firstMonthId = months[0]
    const lastMonthId = months[months.length - 1]
    const everyMonths =
      months.length > 1 ? monthsBetween(firstMonthId, lastMonthId) / (months.length - 1) : null

    out.push({
      label: g.label,
      categoryId: g.categoryId,
      amountJpy,
      previousAmountJpy,
      changeRatio,
      raised: changeRatio !== null && changeRatio > 0,
      monthCount: months.length,
      firstMonthId,
      lastMonthId,
      everyMonths,
      // sin dos apariciones no se sabe cada cuanto vuelve: se cuenta una al ano
      yearlyJpy: everyMonths && everyMonths > 0 ? (amountJpy * 12) / everyMonths : amountJpy,
      totalJpy: sum(amounts),
    })
  }

  return out.sort((a, b) => b.yearlyJpy - a.yearlyJpy)
}

/** '2026-08' -> '2026-Q3'. */
export function quarterOf(monthId: string): string {
  const [y, m] = monthId.split('-').map(Number)
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`
}

export interface QuarterTicket {
  /** '2026-Q3' */
  quarterId: string
  totalJpy: number
  count: number
  /** ticket medio del trimestre */
  avgJpy: number
}

/**
 * Ticket medio de un comercio por TRIMESTRE, no por mes: mes a mes casi todo
 * son una o dos compras, asi que la media salta sin querer decir nada y los
 * meses en que no se pisa el sitio abren huecos. Por trimestres hay bastantes
 * tickets para que la media signifique algo.
 *
 * Solo salen los trimestres en los que hubo alguna compra: un trimestre sin
 * ninguna no es "ticket medio cero", es que no se fue.
 */
export function quarterlyTicket(
  data: AppData,
  label: string,
  opts: { monthIds?: string[] } = {},
): QuarterTicket[] {
  const key = normalizeLabel(label)
  if (!key) return []
  const allow = opts.monthIds ? new Set(opts.monthIds) : null

  const byQuarter = new Map<string, { totalJpy: number; count: number }>()
  for (const e of data.expenses) {
    if (e.kind === 'noCost') continue
    if (normalizeLabel(e.label) !== key) continue
    if (allow && !allow.has(e.monthId)) continue
    if (!isValidMonthId(e.monthId)) continue
    const q = quarterOf(e.monthId)
    const cur = byQuarter.get(q) ?? { totalJpy: 0, count: 0 }
    cur.totalJpy += e.amount
    cur.count += 1
    byQuarter.set(q, cur)
  }

  return [...byQuarter.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([quarterId, v]) => ({
      quarterId,
      totalJpy: v.totalJpy,
      count: v.count,
      avgJpy: v.count ? v.totalJpy / v.count : 0,
    }))
}

/* ------------------------------------------------------------------ *
 * Ayudas de presentacion
 * ------------------------------------------------------------------ */

export function categoryById(cats: Category[], id: string): Category | undefined {
  return cats.find((c) => c.id === id)
}

/**
 * Nombre a mostrar de una categoria en el idioma activo. Las cinco por
 * defecto (las del Excel original) llevan tambien su `nameJa`; si el idioma
 * activo es japones y la categoria tiene uno, se usa ese en vez de `name`
 * (que solo se guarda en un idioma, tipicamente el espanol de por defecto) -
 * si no, la categoria por defecto se veria en espanol aunque la interfaz
 * este en japones. Una categoria propia sin `nameJa` sigue mostrando `name`
 * tal cual, en el idioma en que se escribio.
 */
export function categoryLabel(c: Category, lang: Lang): string {
  return lang === 'ja' && c.nameJa ? c.nameJa : c.name
}

export function activeCategories(cats: Category[]): Category[] {
  return cats.filter((c) => !c.archived)
}
