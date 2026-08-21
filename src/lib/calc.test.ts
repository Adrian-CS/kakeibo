import { describe, expect, it } from 'vitest'
import {
  accountToJpy,
  categoryLimitsJpy,
  computeStats,
  computeYoy,
  daysInMonth,
  isValidMonthId,
  median,
  monthBurn,
  monthRange,
  monthTotals,
  monthsWithData,
  noCostItems,
  normalizeLabel,
  overspendDebt,
  projectMonth,
  projectSavings,
  recentActiveAverageJpy,
  shiftMonth,
  snapshotTotals,
  topExpenses,
  topLabels,
} from './calc'
import { emptyData } from './defaults'
import type { AppData, Expense } from './types'

function build(): AppData {
  const base = emptyData(new Date('2026-08-15T00:00:00'))
  const e = (
    monthId: string,
    categoryId: string,
    label: string,
    amount: number,
    kind: Expense['kind'] = 'normal',
    day?: number,
  ): Expense => ({ id: `${monthId}-${label}-${amount}`, monthId, categoryId, label, amount, kind, day })

  return {
    ...base,
    months: [
      { id: '2026-07', rentJpy: 82000, extras: [{ id: 'x1', label: 'luz', amount: 5000 }], fxRate: 0.0056, limitJpy: 200000, incomeJpy: 0 },
      { id: '2026-08', rentJpy: 80000, extras: [], fxRate: 0.005, limitJpy: 150000, incomeJpy: 0 },
    ],
    expenses: [
      e('2026-07', 'eating_out', 'mcdonals', 1000),
      e('2026-07', 'eating_out', 'Uber ', 2000),
      e('2026-07', 'groceries', 'seiyu', 3000, 'normal', 5),
      e('2026-07', 'fixed_transport', 'netflix', 1590, 'recurring'),
      e('2026-07', 'home', 'mudanza', 100000, 'extraordinary'),
      e('2026-08', 'eating_out', 'uber', 4000, 'normal', 2),
      e('2026-08', 'leisure', 'steam', 2000, 'normal', 20),
    ],
  }
}

describe('utilidades de fecha', () => {
  it('cuenta los dias del mes', () => {
    expect(daysInMonth('2026-02')).toBe(28)
    expect(daysInMonth('2024-02')).toBe(29)
    expect(daysInMonth('2026-08')).toBe(31)
    expect(daysInMonth('2026-04')).toBe(30)
  })

  it('desplaza meses cruzando el ano', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-08', 0)).toBe('2026-08')
  })

  it('valida identificadores de mes', () => {
    expect(isValidMonthId('2026-08')).toBe(true)
    expect(isValidMonthId('2026-13')).toBe(false)
    expect(isValidMonthId('2026-00')).toBe(false)
    expect(isValidMonthId('26-8')).toBe(false)
  })

  it('genera rangos continuos', () => {
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    expect(monthRange('2026-02', '2026-01')).toEqual([])
  })

  it('calcula la mediana', () => {
    expect(median([])).toBe(0)
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })
})

describe('totales del mes (formulas del Excel)', () => {
  const data = build()

  it('suma filas + alquiler + extras como el 合計', () => {
    const t = monthTotals(data, '2026-07')
    // 1000 + 2000 + 3000 + 1590 + 100000 = 107590
    expect(t.itemsJpy).toBe(107590)
    expect(t.totalJpy).toBe(107590 + 82000 + 5000)
    expect(t.rentJpy).toBe(82000)
    expect(t.extrasJpy).toBe(5000)
  })

  it('separa vida diaria, fijos y otros', () => {
    const t = monthTotals(data, '2026-07')
    expect(t.dailyLifeJpy).toBe(1000 + 2000 + 3000)
    expect(t.fixedJpy).toBe(1590 + 82000 + 5000)
    expect(t.otherJpy).toBe(t.totalJpy - t.fixedJpy)
    expect(t.extraordinaryJpy).toBe(100000)
  })

  it('calcula limite, balance y porcentaje', () => {
    const t = monthTotals(data, '2026-08')
    expect(t.totalJpy).toBe(4000 + 2000 + 80000)
    expect(t.limitJpy).toBe(150000)
    expect(t.balanceJpy).toBe(150000 - 86000)
    expect(t.usedRatio).toBeCloseTo(86000 / 150000, 6)
  })

  it('el ingreso del mes cae al valor por defecto de ajustes si no se pone uno', () => {
    const base = emptyData(new Date('2026-08-15T00:00:00'))
    const withDefault: AppData = {
      ...base,
      settings: { ...base.settings, defaultIncomeJpy: 300000 },
      months: [{ id: '2026-08', rentJpy: 0, extras: [], fxRate: 0.0056, limitJpy: 200000, incomeJpy: 0 }],
    }
    expect(monthTotals(withDefault, '2026-08').incomeJpy).toBe(0)

    const withOverride: AppData = {
      ...withDefault,
      months: [{ id: '2026-08', rentJpy: 0, extras: [], fxRate: 0.0056, limitJpy: 200000, incomeJpy: 350000 }],
    }
    expect(monthTotals(withOverride, '2026-08').incomeJpy).toBe(350000)

    // un mes que ni siquiera existe aun: cae al valor por defecto de ajustes
    expect(monthTotals(withDefault, '2030-01').incomeJpy).toBe(300000)
  })

  it('los apuntes "sin coste" no cuentan en ningun total, pero se listan aparte', () => {
    const withGift: AppData = {
      ...data,
      expenses: [
        ...data.expenses,
        {
          id: 'gift-1',
          monthId: '2026-07',
          categoryId: 'eating_out',
          label: 'regalo cumpleanos',
          amount: 5000,
          kind: 'noCost',
        },
      ],
    }
    const before = monthTotals(data, '2026-07')
    const after = monthTotals(withGift, '2026-07')
    expect(after.totalJpy).toBe(before.totalJpy)
    expect(after.itemsJpy).toBe(before.itemsJpy)
    expect(after.dailyLifeJpy).toBe(before.dailyLifeJpy)
    expect(after.byCategory.eating_out).toBe(before.byCategory.eating_out)
    expect(after.count).toBe(before.count)
    expect(after.noCostJpy).toBe(5000)
    expect(after.noCostCount).toBe(1)
  })

  it('un mes sin datos no rompe nada', () => {
    const t = monthTotals(data, '2030-01')
    expect(t.totalJpy).toBe(0)
    expect(t.usedRatio).toBe(0)
    expect(t.perDayJpy).toBe(0)
  })

  it('reparte el total entre los dias del mes', () => {
    const t = monthTotals(data, '2026-08')
    expect(t.perDayJpy).toBeCloseTo(86000 / 31, 6)
  })
})

describe('deuda por sobregasto', () => {
  it('null si el mes no existe, o si no se paso del limite', () => {
    const data = build()
    expect(overspendDebt(data, '2030-01')).toBeNull()
    // 2026-08: 86000 de total, limite 150000 -> no se paso
    expect(overspendDebt(data, '2026-08')).toBeNull()
  })

  it('calcula cuanto se paso y la fecha del ultimo dia del mes', () => {
    const base = emptyData(new Date('2026-08-15T00:00:00'))
    const data: AppData = {
      ...base,
      months: [{ id: '2026-08', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 50000, incomeJpy: 0 }],
      expenses: [
        { id: 'e1', monthId: '2026-08', categoryId: 'eating_out', label: 'x', amount: 4000, kind: 'normal' },
      ],
    }
    // total: 80000 + 4000 = 84000, limite 50000 -> se paso en 34000
    expect(overspendDebt(data, '2026-08')).toEqual({
      monthId: '2026-08',
      amountJpy: 34000,
      date: '2026-08-31',
    })
  })
})

describe('estadisticas', () => {
  const data = build()

  it('lista los meses con datos en orden', () => {
    expect(monthsWithData(data)).toEqual(['2026-07', '2026-08'])
  })

  it('agrega totales, media y variacion mensual', () => {
    const s = computeStats(data)
    expect(s.months).toHaveLength(2)
    expect(s.currentJpy).toBe(86000)
    expect(s.previousJpy).toBe(194590)
    expect(s.momRatio).toBeCloseTo(86000 / 194590 - 1, 6)
    expect(s.averageJpy).toBeCloseTo((194590 + 86000) / 2, 6)
  })

  it('puede excluir los gastos extraordinarios', () => {
    const s = computeStats(data, { excludeExtraordinary: true })
    expect(s.months[0].totalJpy).toBe(194590 - 100000)
  })

  it('respeta la ventana de ultimos N meses', () => {
    const s = computeStats(data, { lastMonths: 1 })
    expect(s.months.map((m) => m.monthId)).toEqual(['2026-08'])
  })

  it('agrupa conceptos normalizando el nombre', () => {
    const top = topLabels(data, { limit: 5 })
    const uber = top.find((l) => l.label.toLowerCase().trim() === 'uber')
    expect(uber?.totalJpy).toBe(6000)
    expect(uber?.count).toBe(2)
    expect(normalizeLabel('  Uber  ')).toBe('uber')
    expect(normalizeLabel('Lawson.')).toBe('lawson')
  })

  it('ordena los gastos mas grandes', () => {
    const top = topExpenses(data, { limit: 2 })
    expect(top[0].amount).toBe(100000)
    expect(top[1].amount).toBe(4000)
  })

  it('filtra rankings por mes', () => {
    const top = topLabels(data, { monthIds: ['2026-08'] })
    expect(top.map((l) => l.label.toLowerCase())).toEqual(['uber', 'steam'])
  })

  it('los "sin coste" quedan fuera de los rankings de gasto, pero se pueden listar aparte', () => {
    const withGift: AppData = {
      ...data,
      expenses: [
        ...data.expenses,
        { id: 'gift-2', monthId: '2026-08', categoryId: 'leisure', label: 'regalo', amount: 9000, kind: 'noCost' },
      ],
    }
    expect(topExpenses(withGift, { limit: 1 })[0].amount).toBe(100000)
    expect(topLabels(withGift).find((l) => l.label === 'regalo')).toBeUndefined()
    const gifts = noCostItems(withGift, { monthIds: ['2026-08'] })
    expect(gifts).toHaveLength(1)
    expect(gifts[0].label).toBe('regalo')
  })
})

describe('ritmo del mes', () => {
  it('acumula por dia y pone lo indatado en el dia 1', () => {
    const data = build()
    const burn = monthBurn(data, '2026-08')
    expect(burn).toHaveLength(31)
    // dia 1: alquiler 80000 (sin dia asignado)
    expect(burn[0].cumulativeJpy).toBe(80000)
    // dia 2: + uber 4000
    expect(burn[1].cumulativeJpy).toBe(84000)
    // dia 20: + steam 2000
    expect(burn[19].cumulativeJpy).toBe(86000)
    expect(burn[30].cumulativeJpy).toBe(86000)
    expect(burn[30].paceJpy).toBeCloseTo(150000, 6)
  })

  it('proyecta el mes en curso a partir de lo gastado', () => {
    const data = build()
    const p = projectMonth(data, '2026-08', new Date('2026-08-10T12:00:00'))
    expect(p).toBeCloseTo((86000 / 10) * 31, 6)
    // un mes pasado no se proyecta
    expect(projectMonth(data, '2026-07', new Date('2026-08-10T12:00:00'))).toBe(194590)
  })
})

describe('comparacion con el ano anterior', () => {
  function twoYears(): AppData {
    const base = emptyData(new Date('2026-08-15T00:00:00'))
    const months = ['2025-06', '2025-07', '2026-06', '2026-07', '2026-08'].map((id) => ({
      id,
      rentJpy: 0,
      extras: [],
      fxRate: 0.0056,
      limitJpy: 200000,
      incomeJpy: 0,
    }))
    const amounts: Record<string, number> = {
      '2025-06': 100000,
      '2025-07': 120000,
      '2026-06': 90000,
      '2026-07': 150000,
      '2026-08': 80000,
    }
    return {
      ...base,
      months,
      expenses: Object.entries(amounts).map(([monthId, amount]) => ({
        id: `e-${monthId}`,
        monthId,
        categoryId: 'eating_out',
        label: 'x',
        amount,
        kind: 'normal' as const,
      })),
    }
  }

  it('devuelve doce meses, con huecos donde no hay datos', () => {
    const y = computeYoy(twoYears(), '2026-08')
    expect(y.year).toBe(2026)
    expect(y.points).toHaveLength(12)
    expect(y.points[5]).toMatchObject({ month: 6, currentJpy: 90000, previousJpy: 100000 })
    expect(y.points[7]).toMatchObject({ month: 8, currentJpy: 80000, previousJpy: null })
    expect(y.points[0]).toMatchObject({ currentJpy: null, previousJpy: null })
  })

  it('solo compara meses que existen en los dos anos', () => {
    const y = computeYoy(twoYears(), '2026-08')
    // junio y julio: 90000+150000 frente a 100000+120000
    expect(y.comparable).toBe(2)
    expect(y.currentTotal).toBe(240000)
    expect(y.previousTotal).toBe(220000)
    expect(y.ratio).toBeCloseTo(240000 / 220000 - 1, 6)
  })

  it('sin ano anterior la variacion es cero', () => {
    const y = computeYoy(twoYears(), '2025-07')
    expect(y.comparable).toBe(0)
    expect(y.ratio).toBe(0)
  })

  it('puede excluir los extraordinarios', () => {
    const data = twoYears()
    data.expenses.push({
      id: 'extra',
      monthId: '2026-06',
      categoryId: 'home',
      label: 'mudanza',
      amount: 300000,
      kind: 'extraordinary',
    })
    expect(computeYoy(data, '2026-08').points[5].currentJpy).toBe(390000)
    expect(computeYoy(data, '2026-08', { excludeExtraordinary: true }).points[5].currentJpy).toBe(90000)
  })
})

describe('ahorros', () => {
  it('convierte divisas y resta las deudas', () => {
    expect(accountToJpy(1000, 'JPY', 0.0056)).toBe(1000)
    expect(accountToJpy(100, 'EUR', 0.005)).toBe(20000)
    const totals = snapshotTotals(
      {
        id: 's1',
        date: '2026-08-01',
        accounts: [
          { id: 'a', name: 'smbc', amount: 28644, currency: 'JPY' },
          { id: 'b', name: 'caja', amount: 923, currency: 'EUR' },
          { id: 'c', name: 'debo', amount: 165900, currency: 'JPY', isDebt: true },
        ],
      },
      0.005,
    )
    expect(totals.assetsJpy).toBe(28644 + 923 / 0.005)
    expect(totals.debtsJpy).toBe(165900)
    expect(totals.netJpy).toBe(totals.assetsJpy - 165900)
  })

  function withIncome(): AppData {
    const base = emptyData(new Date('2026-08-15T00:00:00'))
    return {
      ...base,
      settings: { ...base.settings, defaultIncomeJpy: 250000, defaultLimitJpy: 150000 },
      snapshots: [
        { id: 's1', date: '2026-08-01', accounts: [{ id: 'a', name: 'x', amount: 500000, currency: 'JPY' }] },
      ],
      months: [{ id: '2026-07', rentJpy: 0, extras: [], fxRate: 0.0056, limitJpy: 150000, incomeJpy: 0 }],
      expenses: [
        { id: 'e1', monthId: '2026-07', categoryId: 'eating_out', label: 'x', amount: 100000, kind: 'normal' },
      ],
    }
  }

  it('sin ninguna foto de ahorros no hay nada que proyectar', () => {
    const base = emptyData(new Date('2026-08-15T00:00:00'))
    expect(projectSavings({ ...base, settings: { ...base.settings, defaultIncomeJpy: 250000 } }, [3])).toEqual([])
  })

  it('sin ingresos previstos configurados no hay nada que proyectar', () => {
    const data = withIncome()
    expect(projectSavings({ ...data, settings: { ...data.settings, defaultIncomeJpy: 0 } }, [3])).toEqual([])
  })

  it('proyecta el patrimonio en los tres escenarios', () => {
    const today = new Date('2026-08-15T00:00:00')
    const points = projectSavings(withIncome(), [3, 6], 6, today)
    // peor caso (limite): 250000 (ingreso) - 150000 (limite) = 100000 ahorrados/mes
    // peor caso (categorias): ninguna categoria tiene tope (0) + 82000 de
    //   alquiler por defecto + 0 de extras por defecto = 82000 de gasto
    //   asumido -> 250000 - 82000 = 168000 ahorrados/mes
    // realista: 250000 - 100000 (media de julio, unico mes con datos) = 150000/mes
    expect(points).toEqual([
      {
        months: 3,
        worstCaseJpy: 500000 + 100000 * 3,
        worstCaseByCategoryJpy: 500000 + 168000 * 3,
        realisticJpy: 500000 + 150000 * 3,
      },
      {
        months: 6,
        worstCaseJpy: 500000 + 100000 * 6,
        worstCaseByCategoryJpy: 500000 + 168000 * 6,
        realisticJpy: 500000 + 150000 * 6,
      },
    ])
  })

  it('projectSavings da realisticJpy null sin historial de gasto real, sin afectar a los otros escenarios', () => {
    const today = new Date('2026-08-15T00:00:00')
    const noRealSpend: AppData = {
      ...withIncome(),
      months: [{ id: '2026-07', rentJpy: 0, extras: [], fxRate: 0.0056, limitJpy: 150000, incomeJpy: 0 }],
      expenses: [
        { id: 'e1', monthId: '2026-07', categoryId: 'fixed_transport', label: 'netflix', amount: 1500, kind: 'recurring' },
      ],
    }
    const points = projectSavings(noRealSpend, [3], 6, today)
    expect(points[0].realisticJpy).toBeNull()
    // los otros dos escenarios no dependen del gasto real: siguen igual
    expect(points[0].worstCaseJpy).toBe(500000 + 100000 * 3)
    expect(points[0].worstCaseByCategoryJpy).toBe(500000 + 168000 * 3)
  })

  it('categoryLimitsJpy suma los topes y cuenta como cero las categorias sin tope', () => {
    const cats: AppData['categories'] = [
      { id: 'a', name: 'a', bucket: 'daily', colorSlot: 0, limitJpy: 20000 },
      { id: 'b', name: 'b', bucket: 'daily', colorSlot: 1 }, // sin tope: cuenta como 0
      { id: 'c', name: 'c', bucket: 'other', colorSlot: 2, limitJpy: 0 }, // tope a 0: tambien 0
      { id: 'd', name: 'd', bucket: 'other', colorSlot: 3, limitJpy: 50000, archived: true }, // no cuenta
    ]
    expect(categoryLimitsJpy(cats)).toBe(20000)
  })

  it('recentActiveAverageJpy ignora meses en blanco y el mes en curso', () => {
    const today = new Date('2026-08-15T00:00:00')
    const data: AppData = {
      ...emptyData(today),
      months: [
        // real: alquiler + un gasto
        { id: '2026-06', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 200000, incomeJpy: 0 },
        // visitado pero en blanco: no deberia contar
        { id: '2026-07', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 200000, incomeJpy: 0 },
        // el mes en curso: no deberia contar aunque tenga gasto
        { id: '2026-08', rentJpy: 0, extras: [], fxRate: 0.0056, limitJpy: 200000, incomeJpy: 0 },
      ],
      expenses: [
        { id: 'e1', monthId: '2026-06', categoryId: 'eating_out', label: 'x', amount: 20000, kind: 'normal' },
        { id: 'e2', monthId: '2026-08', categoryId: 'eating_out', label: 'y', amount: 999999, kind: 'normal' },
      ],
    }
    // solo cuenta 2026-06: 80000 (alquiler) + 20000 = 100000
    expect(recentActiveAverageJpy(data, 6, today)).toBe(100000)
  })

  it('recentActiveAverageJpy ignora meses que solo tienen alquiler y recurrentes, sin compras del dia a dia', () => {
    // bug real: un mes con solo el alquiler y una suscripcion copiada del mes
    // anterior (autoFillFixed) tenia un total > 0, pero le faltaba toda la
    // parte variable -no era un mes "vivido"- y rebajaba la media igual
    const today = new Date('2026-08-15T00:00:00')
    const data: AppData = {
      ...emptyData(today),
      months: [
        { id: '2026-06', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 200000, incomeJpy: 0 },
        { id: '2026-07', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 200000, incomeJpy: 0 },
      ],
      expenses: [
        // 2026-06: solo alquiler + una recurrente, nada de dia a dia
        { id: 'e1', monthId: '2026-06', categoryId: 'fixed_transport', label: 'netflix', amount: 1500, kind: 'recurring' },
        // 2026-07: lo mismo, mas una compra real
        { id: 'e2', monthId: '2026-07', categoryId: 'fixed_transport', label: 'netflix', amount: 1500, kind: 'recurring' },
        { id: 'e3', monthId: '2026-07', categoryId: 'eating_out', label: 'sushi', amount: 3000, kind: 'normal' },
      ],
    }
    // 2026-06 (80000+1500=81500) se ignora: solo tiene alquiler+recurrente
    // solo cuenta 2026-07: 80000+1500+3000 = 84500
    expect(recentActiveAverageJpy(data, 6, today)).toBe(84500)
  })

  it('recentActiveAverageJpy devuelve null si ningun mes reciente tiene gasto real (bug real reportado)', () => {
    // bug real: si NINGUN mes de la ventana tenia gasto real, se volvia a la
    // media sin filtrar -la que mezcla meses en blanco y de solo-fijos- y
    // colaba el mismo problema que se acababa de arreglar, por la puerta de
    // atras. Ahora, sin ningun mes activo, no hay media que dar: null.
    const today = new Date('2026-09-15T00:00:00')
    const data: AppData = {
      ...emptyData(today),
      months: [
        { id: '2026-07', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 200000, incomeJpy: 0 },
        { id: '2026-08', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 200000, incomeJpy: 0 },
      ],
      expenses: [
        { id: 'e1', monthId: '2026-07', categoryId: 'fixed_transport', label: 'netflix', amount: 1500, kind: 'recurring' },
        { id: 'e2', monthId: '2026-08', categoryId: 'fixed_transport', label: 'netflix', amount: 1500, kind: 'recurring' },
      ],
    }
    expect(recentActiveAverageJpy(data, 6, today)).toBeNull()
  })

  it('la media "realista" no cuenta un mes visitado y vacio ni el mes en curso', () => {
    // bug real: un mes solo abierto (limite/alquiler por defecto, nada
    // apuntado) o el mes en curso (a medias) rebajaban la media artificialmente
    // y el ahorro "realista" salia demasiado optimista
    const today = new Date('2026-08-15T00:00:00')
    const base = withIncome()
    const withNoise: AppData = {
      ...base,
      months: [
        ...base.months,
        // visitado pero en blanco: solo trae el limite y el alquiler por defecto
        { id: '2026-06', rentJpy: 82000, extras: [], fxRate: 0.0056, limitJpy: 150000, incomeJpy: 0 },
        // el mes en curso, a medias
        { id: '2026-08', rentJpy: 0, extras: [], fxRate: 0.0056, limitJpy: 150000, incomeJpy: 0 },
      ],
      expenses: [
        ...base.expenses,
        { id: 'e2', monthId: '2026-08', categoryId: 'eating_out', label: 'y', amount: 5000, kind: 'normal' },
      ],
    }
    const withoutNoise = projectSavings(base, [3], 6, today)
    const withNoiseResult = projectSavings(withNoise, [3], 6, today)
    expect(withNoiseResult).toEqual(withoutNoise)
  })
})
