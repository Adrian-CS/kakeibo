import { describe, expect, it } from 'vitest'
import {
  accountToJpy,
  backtestForecast,
  categoryLabel,
  categoryLimitsJpy,
  computeStats,
  computeYoy,
  daysInMonth,
  debtAccounts,
  debtTotalJpy,
  hasRealSpend,
  isValidMonthId,
  lastClosedMonthId,
  leakJpy,
  median,
  monthIncomeJpy,
  monthsBetween,
  monthsOfRunway,
  monthBurn,
  monthRange,
  monthTotals,
  monthsWithData,
  noCostItems,
  normalizeLabel,
  overspendDebt,
  projectMonth,
  projectSavings,
  mergeNetWorthMonthly,
  mergeSavingsBands,
  mergeSavingsRateSeries,
  netWorthMonthly,
  percentiles,
  projectSavingsBands,
  quarterOf,
  quarterlyTicket,
  recentActiveAverageJpy,
  recurringItems,
  savingsGoal,
  savingsRate,
  savingsRateSeries,
  sumPercentiles,
  shiftMonth,
  snapshotTotals,
  topExpenses,
  topLabels,
  upcomingExpenses,
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
    expect(t.recurringJpy).toBe(1590)
    expect(t.fixedJpy).toBe(1590 + 82000 + 5000)
    // "otros" son las filas que no son vida diaria ni recurrentes: solo la
    // mudanza (el netflix recurrente ya cuenta en los fijos, y comer fuera y
    // el super en vida diaria)
    expect(t.otherJpy).toBe(100000)
    expect(t.extraordinaryJpy).toBe(100000)
  })

  it('un abono recurrente en negativo no infla "otros gastos"', () => {
    // regresion: otherJpy era total - fijos, asi que un recurrente negativo
    // bajaba los fijos y por tanto SUBIA "otros" en la misma cantidad, ademas
    // de contar ahi la comida diaria
    const withRefund: AppData = {
      ...data,
      expenses: [
        ...data.expenses,
        { id: 'r-neg', monthId: '2026-07', categoryId: 'fixed_transport', label: 'transporte empresa', amount: -13550, kind: 'recurring' },
      ],
    }
    expect(monthTotals(withRefund, '2026-07').otherJpy).toBe(monthTotals(data, '2026-07').otherJpy)
  })

  it('un recurrente negativo (abono de transporte) resta de los gastos fijos', () => {
    const withRefund: AppData = {
      ...data,
      expenses: [
        ...data.expenses,
        { id: 'r-neg', monthId: '2026-07', categoryId: 'fixed_transport', label: 'transporte empresa', amount: -13550, kind: 'recurring' },
      ],
    }
    const t = monthTotals(withRefund, '2026-07')
    expect(t.recurringJpy).toBe(1590 - 13550)
    expect(t.fixedJpy).toBe(82000 + 5000 + 1590 - 13550)
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
    // un 0 en el mes cuenta como "sin poner" (ver `monthIncomeJpy`): antes se
    // quedaba en 0 y los meses guardados antes de que existiera el campo
    // apagaban la prevision de ahorro para siempre
    expect(monthTotals(withDefault, '2026-08').incomeJpy).toBe(300000)

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

  it('hasRealSpend: cuenta normal/extraordinario, no recurrente ni sin coste', () => {
    expect(hasRealSpend(data, '2026-07')).toBe(true) // tiene normales y un extraordinario
    const soloFijos: AppData = {
      ...data,
      expenses: [
        { id: 'r1', monthId: '2026-09', categoryId: 'fixed_transport', label: 'netflix', amount: 1590, kind: 'recurring' },
        { id: 'r2', monthId: '2026-09', categoryId: 'home', label: 'regalo', amount: 3000, kind: 'noCost' },
      ],
    }
    expect(hasRealSpend(soloFijos, '2026-09')).toBe(false)
    expect(hasRealSpend(data, '2026-10')).toBe(false) // sin ningun apunte
  })

  it('media, mediana y extremos ignoran un mes abierto de pasada o de solo fijos', () => {
    // '2026-06' se abrio sin apuntar nada (limite por defecto, total 0);
    // '2026-09' solo tiene alquiler y un fijo recurrente, sin gasto del dia a
    // dia: ninguno de los dos deberia contar como "mes real"
    const withBlanks: AppData = {
      ...data,
      months: [
        ...data.months,
        { id: '2026-06', rentJpy: 0, extras: [], fxRate: 0.0056, limitJpy: 150000, incomeJpy: 0 },
        { id: '2026-09', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 150000, incomeJpy: 0 },
      ],
      expenses: [
        ...data.expenses,
        {
          id: '2026-09-netflix',
          monthId: '2026-09',
          categoryId: 'fixed_transport',
          label: 'netflix',
          amount: 1590,
          kind: 'recurring',
        },
      ],
    }
    // '2026-09' es futuro respecto a "hoy" real: se le pasa un "hoy" de
    // pruebas para que cuente, que es justo lo que se quiere probar aqui
    const s = computeStats(withBlanks, { today: new Date('2026-10-01T00:00:00') })
    expect(s.months.map((m) => m.monthId)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09'])
    // sigue siendo la media de solo julio y agosto, como sin los meses en blanco
    expect(s.averageJpy).toBeCloseTo((194590 + 86000) / 2, 6)
    expect(s.medianJpy).toBeCloseTo((194590 + 86000) / 2, 6)
    expect(s.minMonth?.monthId).toBe('2026-08')
    expect(s.maxMonth?.monthId).toBe('2026-07')
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

  it('unos meses futuros en blanco (varios "mes siguiente" de mas) no tapan el gasto real reciente', () => {
    // bug real reportado: navegar varios meses hacia delante crea meses en
    // blanco por delante del actual (heredan alquiler/fijos via
    // autoFillFixed, pero ningun gasto real); antes, esos meses futuros
    // ocupaban el final de "los ultimos N meses con datos" y desplazaban la
    // ventana lejos del gasto real reciente, dando "sin datos" pese a haber
    // historial de sobra
    const today = new Date('2026-08-15T00:00:00')
    const data: AppData = {
      ...emptyData(today),
      months: [
        { id: '2026-08', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 200000, incomeJpy: 0 },
        // meses futuros, abiertos de pasada al navegar hacia delante
        { id: '2026-09', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 200000, incomeJpy: 0 },
        { id: '2026-10', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 200000, incomeJpy: 0 },
        { id: '2026-11', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 200000, incomeJpy: 0 },
        { id: '2026-12', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 200000, incomeJpy: 0 },
        { id: '2027-01', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 200000, incomeJpy: 0 },
        { id: '2027-02', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 200000, incomeJpy: 0 },
      ],
      // 2026-08 (el mes en curso) es el unico con gasto real de verdad
      expenses: [
        { id: 'e1', monthId: '2026-08', categoryId: 'eating_out', label: 'x', amount: 3000, kind: 'normal' },
      ],
    }
    // sin el corte de meses futuros, "los ultimos 6 con datos" habrian sido
    // sep-2026..feb-2027 (todos en blanco): aqui la unica ventana valida es
    // justo el mes en curso, que se excluye por estar a medias -> sin datos
    expect(recentActiveAverageJpy(data, 6, today)).toBeNull()
    // pero si "hoy" avanza al mes siguiente, agosto ya no es el mes en curso
    // y su gasto real cuenta
    const nextMonth = new Date('2026-09-15T00:00:00')
    expect(recentActiveAverageJpy(data, 6, nextMonth)).toBe(83000)
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


/* ------------------------------------------------------------------ *
 * Ingresos, tasa de ahorro y fuga
 * ------------------------------------------------------------------ */

describe('monthIncomeJpy', () => {
  function withIncomes(monthIncome: number, defaultIncome: number): AppData {
    const base = emptyData(new Date('2026-08-15T00:00:00'))
    return {
      ...base,
      settings: { ...base.settings, defaultIncomeJpy: defaultIncome },
      months: [{ id: '2026-07', rentJpy: 0, extras: [], fxRate: 0.0056, limitJpy: 150000, incomeJpy: monthIncome }],
    }
  }

  it('manda el ingreso del mes si lo tiene puesto', () => {
    expect(monthIncomeJpy(withIncomes(300000, 250000), '2026-07')).toBe(300000)
  })

  it('sin ingreso propio cae al de Ajustes', () => {
    // 0 = "sin poner", no "cobro cero": si no, un mes creado antes de
    // configurar los ingresos apagaria la prevision para siempre
    expect(monthIncomeJpy(withIncomes(0, 250000), '2026-07')).toBe(250000)
  })

  it('un mes que ni existe usa el de Ajustes', () => {
    expect(monthIncomeJpy(withIncomes(300000, 250000), '2026-09')).toBe(250000)
  })

  it('sin nada configurado da 0', () => {
    expect(monthIncomeJpy(withIncomes(0, 0), '2026-07')).toBe(0)
  })
})

describe('savingsRate', () => {
  function withSpend(income: number, spend: number): AppData {
    const base = emptyData(new Date('2026-08-15T00:00:00'))
    return {
      ...base,
      months: [{ id: '2026-07', rentJpy: 0, extras: [], fxRate: 0.0056, limitJpy: 150000, incomeJpy: income }],
      expenses: [
        { id: 'e1', monthId: '2026-07', categoryId: 'eating_out', label: 'x', amount: spend, kind: 'normal' },
      ],
    }
  }

  it('es (ingresos - gasto) / ingresos', () => {
    expect(savingsRate(withSpend(200000, 150000), '2026-07')).toBeCloseTo(0.25, 10)
  })

  it('sale negativa el mes que se gasta mas de lo que entra', () => {
    expect(savingsRate(withSpend(200000, 250000), '2026-07')).toBeCloseTo(-0.25, 10)
  })

  it('sin ingresos no hay tasa (null, no 0)', () => {
    // un 0 se leeria como "no ahorras nada" en vez de "falta el dato"
    expect(savingsRate(withSpend(0, 150000), '2026-07')).toBeNull()
  })
})

describe('leakJpy', () => {
  it('suma solo los apuntes recurrentes del mes', () => {
    const data = build()
    // julio: netflix 1590 recurrente; el resto son normales/extraordinarios
    expect(leakJpy(data, '2026-07')).toBe(1590)
    expect(leakJpy(data, '2026-08')).toBe(0)
  })

  it('no cuenta el alquiler ni los extras fijos del mes', () => {
    // van aparte en "Gastos fijos": se deciden una vez y no se escapan solos
    const data = build()
    expect(leakJpy(data, '2026-07')).toBeLessThan(monthTotals(data, '2026-07').fixedJpy)
  })

  it('un mes sin nada apuntado no fuga nada', () => {
    expect(leakJpy(build(), '2030-01')).toBe(0)
  })
})

describe('lastClosedMonthId', () => {
  const today = new Date('2026-08-15T00:00:00')

  it('coge el ultimo mes anterior al de hoy con gasto real', () => {
    expect(lastClosedMonthId(build(), today)).toBe('2026-07')
  })

  it('nunca coge el mes en curso, que esta a medias', () => {
    const nextMonth = new Date('2026-09-15T00:00:00')
    expect(lastClosedMonthId(build(), nextMonth)).toBe('2026-08')
  })

  it('si ningun mes cerrado tiene gasto real, coge el ultimo con datos', () => {
    const base = emptyData(today)
    const onlyFixed: AppData = {
      ...base,
      months: [
        { id: '2026-06', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 150000, incomeJpy: 0 },
        { id: '2026-07', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 150000, incomeJpy: 0 },
      ],
      expenses: [],
    }
    expect(lastClosedMonthId(onlyFixed, today)).toBe('2026-07')
  })

  it('sin ningun mes cerrado devuelve null', () => {
    expect(lastClosedMonthId(emptyData(today), today)).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * Deudas y colchon
 * ------------------------------------------------------------------ */

describe('deudas', () => {
  function withSnapshots(): AppData {
    const base = emptyData(new Date('2026-08-15T00:00:00'))
    return {
      ...base,
      settings: { ...base.settings, defaultFxRate: 0.005 },
      snapshots: [
        {
          id: 's0',
          date: '2026-06-30',
          accounts: [{ id: 'viejo', name: 'tarjeta vieja', amount: 999999, currency: 'JPY', isDebt: true }],
        },
        {
          id: 's1',
          date: '2026-08-01',
          accounts: [
            { id: 'a1', name: 'banco', amount: 500000, currency: 'JPY' },
            { id: 'a2', name: 'tarjeta', amount: 40000, currency: 'JPY', isDebt: true },
            { id: 'a3', name: 'prestamo', amount: 500, currency: 'EUR', isDebt: true },
          ],
        },
      ],
    }
  }

  it('solo mira la ultima foto: las anteriores son historial, no saldo de hoy', () => {
    expect(debtAccounts(withSnapshots()).map((a) => a.id)).toEqual(['a2', 'a3'])
  })

  it('suma las deudas pasando la moneda secundaria a yenes', () => {
    // 500 EUR con 1 ¥ = 0,005 € son 100000 ¥
    expect(debtTotalJpy(withSnapshots())).toBe(40000 + 100000)
  })

  it('sin fotos no hay deuda que enseñar', () => {
    const base = emptyData(new Date('2026-08-15T00:00:00'))
    expect(debtAccounts(base)).toEqual([])
    expect(debtTotalJpy(base)).toBe(0)
  })
})

describe('monthsOfRunway', () => {
  const today = new Date('2026-08-15T00:00:00')

  function withRunway(): AppData {
    const base = emptyData(today)
    return {
      ...base,
      months: [{ id: '2026-07', rentJpy: 0, extras: [], fxRate: 0.0056, limitJpy: 150000, incomeJpy: 0 }],
      expenses: [
        { id: 'e1', monthId: '2026-07', categoryId: 'eating_out', label: 'x', amount: 100000, kind: 'normal' },
      ],
      snapshots: [
        {
          id: 's1',
          date: '2026-08-01',
          accounts: [
            { id: 'a1', name: 'banco', amount: 600000, currency: 'JPY' },
            { id: 'a2', name: 'tarjeta', amount: 200000, currency: 'JPY', isDebt: true },
          ],
        },
      ],
    }
  }

  it('divide los activos entre el gasto medio de los meses activos', () => {
    // 600000 de activos / 100000 de gasto medio = 6 meses. La deuda no resta:
    // no se puede gastar en vivir, asi que contestaria otra pregunta
    expect(monthsOfRunway(withRunway(), today)).toBe(6)
  })

  it('sin historial de gasto real no da numero', () => {
    const noSpend: AppData = { ...withRunway(), expenses: [] }
    expect(monthsOfRunway(noSpend, today)).toBeNull()
  })

  it('sin ninguna foto tampoco', () => {
    const noSnapshot: AppData = { ...withRunway(), snapshots: [] }
    expect(monthsOfRunway(noSnapshot, today)).toBeNull()
  })
})


/* ------------------------------------------------------------------ *
 * Prevision
 * ------------------------------------------------------------------ */

describe('prevision', () => {
  const today = new Date('2026-08-15T00:00:00')

  /**
   * Seis meses ya cerrados con gasto real (90k a 150k) y una foto de 500k de
   * patrimonio: lo justo para banda, meta y comprobacion.
   */
  function forecastSeed(): AppData {
    const base = emptyData(today)
    const totals: [string, number][] = [
      ['2026-02', 100000],
      ['2026-03', 110000],
      ['2026-04', 90000],
      ['2026-05', 130000],
      ['2026-06', 120000],
      ['2026-07', 150000],
    ]
    return {
      ...base,
      settings: { ...base.settings, defaultIncomeJpy: 250000 },
      expenses: totals.map(([monthId, amount]) => ({
        id: `e-${monthId}`,
        monthId,
        categoryId: 'eating_out',
        label: 'gasto',
        amount,
        kind: 'normal' as const,
      })),
      snapshots: [
        { id: 's1', date: '2026-08-01', accounts: [{ id: 'a1', name: 'banco', amount: 500000, currency: 'JPY' }] },
      ],
    }
  }

  describe('percentiles', () => {
    it('reparte el gasto de los meses cerrados con actividad', () => {
      // ordenados: 90 100 110 120 130 150 (miles)
      expect(percentiles(forecastSeed(), 12, today)).toEqual({
        p25: 102500,
        p50: 115000,
        p75: 127500,
        monthCount: 6,
      })
    })

    it('la mediana coincide con median(), que es la misma cuenta', () => {
      const p = percentiles(forecastSeed(), 12, today)!
      expect(p.p50).toBe(median([100000, 110000, 90000, 130000, 120000, 150000]))
    })

    it('ni el mes en curso ni los meses de solo fijos entran', () => {
      const seed = forecastSeed()
      const conRuido: AppData = {
        ...seed,
        expenses: [
          ...seed.expenses,
          // el mes en curso, a medias
          { id: 'x1', monthId: '2026-08', categoryId: 'eating_out', label: 'x', amount: 5000, kind: 'normal' },
          // un mes de solo recurrentes: no es un mes completo de verdad
          { id: 'x2', monthId: '2026-01', categoryId: 'fixed_transport', label: 'netflix', amount: 1590, kind: 'recurring' },
        ],
      }
      expect(percentiles(conRuido, 12, today)).toEqual(percentiles(seed, 12, today))
    })

    it('sin historial no hay percentiles', () => {
      expect(percentiles(emptyData(today), 12, today)).toBeNull()
    })
  })

  describe('projectSavingsBands', () => {
    it('proyecta mes a mes: p25 arriba, p75 abajo', () => {
      const points = projectSavingsBands(forecastSeed(), 2, 12, today)
      expect(points).toEqual([
        { monthId: '2026-09', months: 1, highJpy: 647500, medianJpy: 635000, lowJpy: 622500 },
        { monthId: '2026-10', months: 2, highJpy: 795000, medianJpy: 770000, lowJpy: 745000 },
      ])
    })

    it('gastar menos deja mas patrimonio: la banda nunca sale del reves', () => {
      for (const p of projectSavingsBands(forecastSeed(), 12, 12, today)) {
        expect(p.highJpy).toBeGreaterThanOrEqual(p.medianJpy)
        expect(p.medianJpy).toBeGreaterThanOrEqual(p.lowJpy)
      }
    })

    it('sin foto, sin ingresos o sin historial no hay banda que dibujar', () => {
      const seed = forecastSeed()
      expect(projectSavingsBands({ ...seed, snapshots: [] }, 6, 12, today)).toEqual([])
      expect(
        projectSavingsBands({ ...seed, settings: { ...seed.settings, defaultIncomeJpy: 0 } }, 6, 12, today),
      ).toEqual([])
      expect(projectSavingsBands({ ...seed, expenses: [] }, 6, 12, today)).toEqual([])
    })
  })

  describe('netWorthMonthly', () => {
    it('arrastra la ultima foto conocida a los meses sin foto', () => {
      const seed = forecastSeed()
      const dos: AppData = {
        ...seed,
        snapshots: [
          { id: 's0', date: '2026-06-30', accounts: [{ id: 'a', name: 'x', amount: 300000, currency: 'JPY' }] },
          ...seed.snapshots,
        ],
      }
      expect(netWorthMonthly(dos, today)).toEqual([
        { monthId: '2026-06', netJpy: 300000, assetsJpy: 300000 },
        { monthId: '2026-07', netJpy: 300000, assetsJpy: 300000 },
        { monthId: '2026-08', netJpy: 500000, assetsJpy: 500000 },
      ])
    })

    it('sin fotos no hay serie', () => {
      expect(netWorthMonthly(emptyData(today), today)).toEqual([])
    })
  })

  describe('savingsGoal', () => {
    function withGoal(targetJpy: number, months: number): AppData {
      const seed = forecastSeed()
      return { ...seed, settings: { ...seed.settings, savingsGoalJpy: targetJpy, savingsGoalMonths: months } }
    }

    it('dice lo que falta, lo que hay que ahorrar al mes y cuando se llega', () => {
      // faltan 500000; al ritmo tipico se ahorran 250000 - 115000 = 135000 al
      // mes, o sea cuatro meses
      const goal = savingsGoal(withGoal(1000000, 12), today)!
      expect(goal.missingJpy).toBe(500000)
      expect(goal.requiredMonthlyJpy).toBeCloseTo(500000 / 12, 6)
      expect(goal.medianMonthlyJpy).toBe(135000)
      expect(goal.dueMonthId).toBe('2027-08')
      expect(goal.etaMonthId).toBe('2026-12')
      expect(goal.onTrack).toBe(true)
    })

    it('avisa cuando al ritmo de siempre no se llega a tiempo', () => {
      const goal = savingsGoal(withGoal(5000000, 12), today)!
      expect(goal.onTrack).toBe(false)
      // 4500000 / 135000 = 34 meses
      expect(goal.etaMonthId).toBe('2029-06')
    })

    it('meta ya cumplida: no falta nada y se llego hoy', () => {
      const goal = savingsGoal(withGoal(400000, 12), today)!
      expect(goal.missingJpy).toBe(0)
      expect(goal.requiredMonthlyJpy).toBe(0)
      expect(goal.onTrack).toBe(true)
      expect(goal.etaMonthId).toBe('2026-08')
    })

    it('sin ritmo del que fiarse no se inventa una fecha', () => {
      const seed = withGoal(1000000, 12)
      const goal = savingsGoal({ ...seed, expenses: [] }, today)!
      expect(goal.medianMonthlyJpy).toBeNull()
      expect(goal.etaMonthId).toBeNull()
      expect(goal.onTrack).toBeNull()
      // pero lo que falta y lo que tocaria ahorrar al mes se sabe igual
      expect(goal.missingJpy).toBe(500000)
    })

    it('sin meta puesta o sin foto no hay nada que decir', () => {
      expect(savingsGoal(forecastSeed(), today)).toBeNull()
      expect(savingsGoal({ ...withGoal(1000000, 12), snapshots: [] }, today)).toBeNull()
    })
  })

  describe('backtestForecast', () => {
    it('aprende con los meses viejos y se examina con los nuevos', () => {
      const bt = backtestForecast(forecastSeed(), 3, today)!
      // entrena con feb-abr (100, 110, 90): mediana 100000
      expect(bt.cutMonthId).toBe('2026-04')
      expect(bt.trainMonthCount).toBe(3)
      expect(bt.testMonthIds).toEqual(['2026-05', '2026-06', '2026-07'])
      expect(bt.predictedJpy).toBe(300000)
      expect(bt.actualJpy).toBe(400000)
      // se quedo un 25 % corto: los tres meses de prueba fueron mas caros
      expect(bt.errorRatio).toBeCloseTo(-0.25, 10)
      expect(bt.insideBand).toBe(0)
    })

    it('nunca deja el entrenamiento sin meses, aunque se pidan muchos de prueba', () => {
      const bt = backtestForecast(forecastSeed(), 99, today)!
      expect(bt.trainMonthCount).toBe(3)
      expect(bt.testMonthIds).toHaveLength(3)
    })

    it('con menos de cuatro meses cerrados no se puede comprobar nada', () => {
      const seed = forecastSeed()
      const corto: AppData = { ...seed, expenses: seed.expenses.slice(0, 3) }
      expect(backtestForecast(corto, 3, today)).toBeNull()
    })
  })


  describe('juntar dos documentos (vista "Juntos")', () => {
    it('el patrimonio mes a mes suma el ultimo valor conocido de cada lado', () => {
      const mio = [
        { monthId: '2026-06', netJpy: 100, assetsJpy: 100 },
        { monthId: '2026-07', netJpy: 150, assetsJpy: 150 },
      ]
      const suyo = [{ monthId: '2026-07', netJpy: 40, assetsJpy: 40 }]
      // en junio la pareja no tenia foto todavia: suma solo lo mio
      expect(mergeNetWorthMonthly([mio, suyo])).toEqual([
        { monthId: '2026-06', netJpy: 100, assetsJpy: 100 },
        { monthId: '2026-07', netJpy: 190, assetsJpy: 190 },
      ])
    })

    it('con un solo lado (o ninguno) no cambia nada', () => {
      const mio = [{ monthId: '2026-07', netJpy: 150, assetsJpy: 150 }]
      expect(mergeNetWorthMonthly([mio, []])).toEqual(mio)
      expect(mergeNetWorthMonthly([[], []])).toEqual([])
    })

    it('las bandas se suman mes a mes, sin tocar las originales', () => {
      const a = [{ monthId: '2026-09', months: 1, highJpy: 10, medianJpy: 8, lowJpy: 6 }]
      const b = [{ monthId: '2026-09', months: 1, highJpy: 100, medianJpy: 80, lowJpy: 60 }]
      expect(mergeSavingsBands([a, b])).toEqual([
        { monthId: '2026-09', months: 1, highJpy: 110, medianJpy: 88, lowJpy: 66 },
      ])
      expect(a[0].highJpy).toBe(10)
    })

    it('los percentiles se suman para que la nota cuadre con la banda dibujada', () => {
      expect(
        sumPercentiles([
          { p25: 10, p50: 20, p75: 30, monthCount: 6 },
          { p25: 1, p50: 2, p75: 3, monthCount: 4 },
        ]),
      ).toEqual({ p25: 11, p50: 22, p75: 33, monthCount: 4 })
    })

    it('si a un lado le falta historial no hay percentiles combinados', () => {
      expect(sumPercentiles([{ p25: 10, p50: 20, p75: 30, monthCount: 6 }, null])).toBeNull()
      expect(sumPercentiles([])).toBeNull()
    })
  })

  describe('upcomingExpenses', () => {
    it('agrupa por mes lo que ya esta apuntado a futuro, con su total', () => {
      const seed = forecastSeed()
      const conFuturo: AppData = {
        ...seed,
        expenses: [
          ...seed.expenses,
          { id: 'f1', monthId: '2026-08', categoryId: 'home', label: 'billetes', amount: 5000, kind: 'normal', day: 20 },
          { id: 'p1', monthId: '2026-08', categoryId: 'home', label: 'ya pasado', amount: 2000, kind: 'normal', day: 3 },
          { id: 'f2', monthId: '2026-09', categoryId: 'home', label: 'mudanza', amount: 30000, kind: 'extraordinary' },
          { id: 'f3', monthId: '2026-09', categoryId: 'home', label: 'regalo', amount: 9000, kind: 'noCost' },
        ],
      }
      const up = upcomingExpenses(conFuturo, today)
      expect(up.count).toBe(2)
      expect(up.totalJpy).toBe(35000)
      expect(up.groups.map((g) => g.monthId)).toEqual(['2026-08', '2026-09'])
      expect(up.groups[0].items.map((e) => e.id)).toEqual(['f1'])
      expect(up.groups[1].totalJpy).toBe(30000)
    })

    it('sin nada apuntado a futuro no hay grupos', () => {
      expect(upcomingExpenses(forecastSeed(), today)).toEqual({ groups: [], totalJpy: 0, count: 0 })
    })
  })
})


/* ------------------------------------------------------------------ *
 * Estadisticas de la fase 3
 * ------------------------------------------------------------------ */

describe('tasa de ahorro mes a mes', () => {
  const today = new Date('2026-08-15T00:00:00')

  function seed(): AppData {
    const base = emptyData(today)
    return {
      ...base,
      settings: { ...base.settings, defaultIncomeJpy: 200000 },
      months: [
        { id: '2026-07', rentJpy: 0, extras: [], fxRate: 0.0056, limitJpy: 200000, incomeJpy: 0 },
        { id: '2026-08', rentJpy: 0, extras: [], fxRate: 0.0056, limitJpy: 200000, incomeJpy: 0 },
      ],
      expenses: [
        { id: 'e1', monthId: '2026-07', categoryId: 'eating_out', label: 'x', amount: 150000, kind: 'normal' },
        { id: 'e2', monthId: '2026-08', categoryId: 'eating_out', label: 'y', amount: 31000, kind: 'normal' },
      ],
    }
  }

  it('calcula la tasa de cada mes', () => {
    const points = savingsRateSeries(seed(), ['2026-07'], today)
    expect(points[0].rate).toBeCloseTo(0.25, 10)
    expect(points[0].inProgress).toBe(false)
    expect(points[0].projectedRate).toBeNull()
  })

  it('marca el mes en curso y le añade su proyeccion a cierre', () => {
    // dia 15 de 31: 31000 gastados van camino de 64066
    const p = savingsRateSeries(seed(), ['2026-08'], today)[0]
    expect(p.inProgress).toBe(true)
    expect(p.rate).toBeCloseTo((200000 - 31000) / 200000, 10)
    expect(p.projectedRate!).toBeCloseTo((200000 - (31000 / 15) * 31) / 200000, 6)
    // la proyeccion es peor que lo que lleva: por eso no se comparan
    expect(p.projectedRate!).toBeLessThan(p.rate!)
  })

  it('sin ingresos no hay tasa que dibujar', () => {
    const data = seed()
    const sinIngresos: AppData = { ...data, settings: { ...data.settings, defaultIncomeJpy: 0 } }
    expect(savingsRateSeries(sinIngresos, ['2026-07'], today)[0].rate).toBeNull()
  })

  it('al juntar dos documentos se suman ingresos y gastos, no las tasas', () => {
    // 50 % y 0 % con ingresos distintos no son un 25 %: son 300000 de
    // ingresos y 200000 de gasto, o sea un 33 %
    const mio = [
      { monthId: '2026-07', incomeJpy: 200000, spentJpy: 100000, rate: 0.5, inProgress: false, projectedRate: null },
    ]
    const suyo = [
      { monthId: '2026-07', incomeJpy: 100000, spentJpy: 100000, rate: 0, inProgress: false, projectedRate: null },
    ]
    const merged = mergeSavingsRateSeries([mio, suyo])
    expect(merged[0].incomeJpy).toBe(300000)
    expect(merged[0].rate).toBeCloseTo(1 / 3, 10)
  })

  it('con un solo documento no cambia nada', () => {
    const one = savingsRateSeries(seed(), ['2026-07'], today)
    expect(mergeSavingsRateSeries([one, []])).toEqual(one)
  })
})

describe('fijos y suscripciones', () => {
  function seed(): AppData {
    const base = emptyData(new Date('2026-08-15T00:00:00'))
    const r = (id: string, monthId: string, label: string, amount: number) => ({
      id,
      monthId,
      categoryId: 'fixed_transport',
      label,
      amount,
      kind: 'recurring' as const,
    })
    return {
      ...base,
      expenses: [
        r('n1', '2026-05', 'Netflix', 1490),
        r('n2', '2026-06', 'netflix ', 1490),
        r('n3', '2026-07', 'Netflix', 1990),
        // cada tres meses
        r('s1', '2026-01', 'seguro', 30000),
        r('s2', '2026-04', 'seguro', 30000),
        r('s3', '2026-07', 'seguro', 30000),
        // una sola vez
        r('u1', '2026-07', 'gimnasio', 8000),
        // no es recurrente: no entra
        { id: 'x1', monthId: '2026-07', categoryId: 'eating_out', label: 'uber', amount: 5000, kind: 'normal' as const },
      ],
    }
  }

  it('agrupa por concepto aunque cambien mayusculas y espacios', () => {
    const netflix = recurringItems(seed()).find((i) => i.label.toLowerCase() === 'netflix')!
    expect(netflix.monthCount).toBe(3)
    expect(netflix.everyMonths).toBe(1)
    expect(netflix.amountJpy).toBe(1990)
    expect(netflix.totalJpy).toBe(1490 + 1490 + 1990)
  })

  it('avisa de la subida de precio y de cuanto', () => {
    const netflix = recurringItems(seed()).find((i) => i.label.toLowerCase() === 'netflix')!
    expect(netflix.previousAmountJpy).toBe(1490)
    expect(netflix.raised).toBe(true)
    expect(netflix.changeRatio!).toBeCloseTo(1990 / 1490 - 1, 10)
  })

  it('saca cada cuanto vuelve y lo que cuesta al ano', () => {
    const seguro = recurringItems(seed()).find((i) => i.label === 'seguro')!
    expect(seguro.everyMonths).toBe(3)
    expect(seguro.yearlyJpy).toBe(30000 * 4)
    expect(seguro.raised).toBe(false)
    expect(seguro.changeRatio).toBeNull()
  })

  it('con una sola aparicion no se inventa una periodicidad', () => {
    const gym = recurringItems(seed()).find((i) => i.label === 'gimnasio')!
    expect(gym.everyMonths).toBeNull()
    expect(gym.yearlyJpy).toBe(8000)
  })

  it('ordena por lo que cuesta al ano y respeta el filtro de meses', () => {
    const items = recurringItems(seed())
    expect(items[0].label).toBe('seguro')
    expect(items.map((i) => i.label.toLowerCase())).not.toContain('uber')

    const soloJulio = recurringItems(seed(), { monthIds: ['2026-07'] })
    expect(soloJulio.every((i) => i.monthCount === 1)).toBe(true)
  })

  it('monthsBetween cuenta los meses de por medio', () => {
    expect(monthsBetween('2026-01', '2026-07')).toBe(6)
    expect(monthsBetween('2026-07', '2026-07')).toBe(0)
    expect(monthsBetween('2026-07', '2026-01')).toBe(0)
  })
})

describe('ticket medio por trimestre', () => {
  function seed(): AppData {
    const base = emptyData(new Date('2026-08-15T00:00:00'))
    const e = (id: string, monthId: string, label: string, amount: number) => ({
      id,
      monthId,
      categoryId: 'eating_out',
      label,
      amount,
      kind: 'normal' as const,
    })
    return {
      ...base,
      expenses: [
        e('a', '2026-01', 'Uber', 1000),
        e('b', '2026-02', 'uber ', 2000),
        e('c', '2026-03', 'UBER', 3000),
        e('d', '2026-07', 'uber', 5000),
        e('f', '2026-07', 'seiyu', 9000),
        { ...e('g', '2026-08', 'uber', 7000), kind: 'noCost' as const },
      ],
    }
  }

  it('reparte los meses en trimestres', () => {
    expect(quarterOf('2026-01')).toBe('2026-Q1')
    expect(quarterOf('2026-03')).toBe('2026-Q1')
    expect(quarterOf('2026-04')).toBe('2026-Q2')
    expect(quarterOf('2026-12')).toBe('2026-Q4')
  })

  it('agrega por trimestre el ticket medio de un comercio', () => {
    // Q1: tres tickets (1000, 2000, 3000) -> media 2000
    expect(quarterlyTicket(seed(), 'uber')).toEqual([
      { quarterId: '2026-Q1', totalJpy: 6000, count: 3, avgJpy: 2000 },
      { quarterId: '2026-Q3', totalJpy: 5000, count: 1, avgJpy: 5000 },
    ])
  })

  it('no inventa trimestres vacios: un trimestre sin compras no es ticket cero', () => {
    expect(quarterlyTicket(seed(), 'uber').map((q) => q.quarterId)).not.toContain('2026-Q2')
  })

  it('deja fuera los apuntes sin coste y respeta el filtro de meses', () => {
    const soloQ1 = quarterlyTicket(seed(), 'uber', { monthIds: ['2026-01', '2026-02', '2026-03'] })
    expect(soloQ1).toHaveLength(1)
    // el de agosto es "sin coste": no cuenta como ticket
    expect(quarterlyTicket(seed(), 'uber').some((q) => q.quarterId === '2026-Q3' && q.count === 1)).toBe(true)
  })

  it('un comercio que no existe no da serie', () => {
    expect(quarterlyTicket(seed(), 'no existe')).toEqual([])
    expect(quarterlyTicket(seed(), '  ')).toEqual([])
  })
})

describe('categoryLabel', () => {
  const withJa = {
    id: 'eating_out',
    name: 'Comer fuera',
    nameJa: '外食',
    bucket: 'daily' as const,
    colorSlot: 0,
  }
  const custom = { id: 'c1', name: 'Mi categoria', bucket: 'other' as const, colorSlot: 1 }

  it('en japones usa nameJa si lo tiene, para no ensenar el nombre en otro idioma', () => {
    expect(categoryLabel(withJa, 'ja')).toBe('外食')
  })

  it('en cualquier otro idioma usa name', () => {
    expect(categoryLabel(withJa, 'es')).toBe('Comer fuera')
    expect(categoryLabel(withJa, 'en')).toBe('Comer fuera')
  })

  it('una categoria propia sin nameJa siempre usa name, sea cual sea el idioma', () => {
    expect(categoryLabel(custom, 'ja')).toBe('Mi categoria')
    expect(categoryLabel(custom, 'es')).toBe('Mi categoria')
  })
})
