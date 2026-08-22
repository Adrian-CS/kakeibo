import { describe, expect, it } from 'vitest'
import {
  combinedCategories,
  combinedDatedCount,
  combinedMonthBurn,
  combinedMonthTotals,
  combinedNoCostItems,
  combinedProjectSavings,
  combinedSnapshotSeries,
  combinedStats,
  combinedTopExpenses,
  combinedTopLabels,
  combinedYoy,
} from './householdCalc'
import { emptyData } from './defaults'
import type { AppData, CategoryLink } from './types'

function withMonth(overrides: Partial<AppData> = {}): AppData {
  const base = emptyData(new Date('2026-08-15T00:00:00'))
  return {
    ...base,
    months: [{ id: '2026-08', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 150000, incomeJpy: 0 }],
    ...overrides,
  }
}

describe('combinedCategories', () => {
  it('prefija mis categorias y anade las de la pareja sin equivalente', () => {
    const mine = [{ id: 'eating_out', name: 'Comer fuera', bucket: 'daily' as const, colorSlot: 0 }]
    const partner = [
      { id: 'eating_out_p', name: 'Comer fuera (pareja)', bucket: 'daily' as const, colorSlot: 0 },
      { id: 'hobby_p', name: 'Ocio pareja', bucket: 'other' as const, colorSlot: 3 },
    ]
    const links: CategoryLink[] = [{ categoryId: 'eating_out', partnerCategoryId: 'eating_out_p' }]
    const cats = combinedCategories(mine, partner, links)
    expect(cats.map((c) => c.id)).toEqual(['mine:eating_out', 'partner:hobby_p'])
  })

  it('deja fuera las categorias archivadas', () => {
    const mine = [{ id: 'a', name: 'a', bucket: 'daily' as const, colorSlot: 0, archived: true }]
    expect(combinedCategories(mine, [], [])).toEqual([])
  })
})

describe('combinedMonthTotals', () => {
  it('sin pareja, devuelve exactamente monthTotals de uno mismo', () => {
    const mine = withMonth({
      expenses: [{ id: 'e1', monthId: '2026-08', categoryId: 'eating_out', label: 'x', amount: 3000, kind: 'normal' }],
    })
    const totals = combinedMonthTotals(mine, null, '2026-08', [])
    expect(totals.totalJpy).toBe(80000 + 3000)
  })

  it('suma los totales y agrupa las categorias enlazadas bajo la mia', () => {
    const mine = withMonth({
      expenses: [{ id: 'e1', monthId: '2026-08', categoryId: 'eating_out', label: 'x', amount: 3000, kind: 'normal' }],
    })
    const partner = withMonth({
      months: [{ id: '2026-08', rentJpy: 90000, extras: [], fxRate: 0.005, limitJpy: 100000, incomeJpy: 0 }],
      expenses: [
        { id: 'e2', monthId: '2026-08', categoryId: 'eating_out_p', label: 'y', amount: 2000, kind: 'normal' },
        { id: 'e3', monthId: '2026-08', categoryId: 'hobby_p', label: 'z', amount: 1000, kind: 'normal' },
      ],
      categories: [
        { id: 'eating_out_p', name: 'Comer fuera (pareja)', bucket: 'daily', colorSlot: 0 },
        { id: 'hobby_p', name: 'Ocio pareja', bucket: 'other', colorSlot: 3 },
      ],
    })
    const links: CategoryLink[] = [{ categoryId: 'eating_out', partnerCategoryId: 'eating_out_p' }]
    const totals = combinedMonthTotals(mine, partner, '2026-08', links)

    // total: (80000+3000) + (90000+2000+1000) = 176000
    expect(totals.totalJpy).toBe(176000)
    expect(totals.limitJpy).toBe(150000 + 100000)
    // la categoria enlazada se suma bajo la mia; la que no tiene enlace, aparte
    expect(totals.byCategory['mine:eating_out']).toBe(3000 + 2000)
    expect(totals.byCategory['partner:hobby_p']).toBe(1000)
    expect(totals.byCategory['mine:hobby_p']).toBeUndefined()
  })
})

describe('combinedStats', () => {
  it('sin pareja, devuelve exactamente computeStats de uno mismo', () => {
    const mine = withMonth({
      expenses: [{ id: 'e1', monthId: '2026-08', categoryId: 'eating_out', label: 'x', amount: 3000, kind: 'normal' }],
    })
    const stats = combinedStats(mine, null, [])
    expect(stats.totalJpy).toBe(80000 + 3000)
  })

  it('combina mes a mes aunque un lado no tenga datos en algun mes', () => {
    const mine: AppData = {
      ...withMonth(),
      months: [
        { id: '2026-07', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 150000, incomeJpy: 0 },
        { id: '2026-08', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 150000, incomeJpy: 0 },
      ],
      expenses: [],
    }
    const partner: AppData = {
      ...withMonth(),
      months: [{ id: '2026-08', rentJpy: 90000, extras: [], fxRate: 0.005, limitJpy: 100000, incomeJpy: 0 }],
      expenses: [],
    }
    const stats = combinedStats(mine, partner, [])
    const months = stats.months.map((m) => m.monthId)
    expect(months).toEqual(['2026-07', '2026-08'])
    expect(stats.months[0].totalJpy).toBe(80000) // solo yo ese mes
    expect(stats.months[1].totalJpy).toBe(80000 + 90000)
  })

  it('media, mediana y extremos ignoran un mes en que ninguno de los dos gasto de verdad', () => {
    const mine: AppData = {
      ...withMonth(),
      months: [
        { id: '2026-07', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 150000, incomeJpy: 0 },
        { id: '2026-08', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 150000, incomeJpy: 0 },
      ],
      // julio: solo alquiler, ni un apunte real; agosto: gasto real de verdad
      expenses: [
        { id: 'e1', monthId: '2026-08', categoryId: 'eating_out', label: 'x', amount: 3000, kind: 'normal' },
      ],
    }
    const partner: AppData = { ...withMonth(), expenses: [] } // solo agosto, sin gasto real tampoco
    const stats = combinedStats(mine, partner, [])
    expect(stats.months.map((m) => m.monthId)).toEqual(['2026-07', '2026-08'])
    // julio (80000, sin gasto real de ninguno) queda fuera de media/extremos
    expect(stats.averageJpy).toBe(80000 + 80000 + 3000)
    expect(stats.medianJpy).toBe(80000 + 80000 + 3000)
    expect(stats.minMonth?.monthId).toBe('2026-08')
    expect(stats.maxMonth?.monthId).toBe('2026-08')
  })
})

describe('combinedSnapshotSeries', () => {
  it('suma el ultimo valor conocido de cada lado en cada fecha', () => {
    const mine: AppData = {
      ...emptyData(),
      snapshots: [
        { id: 's1', date: '2026-08-01', accounts: [{ id: 'a1', name: 'x', amount: 100000, currency: 'JPY' }] },
        { id: 's2', date: '2026-08-15', accounts: [{ id: 'a1', name: 'x', amount: 120000, currency: 'JPY' }] },
      ],
    }
    const partner: AppData = {
      ...emptyData(),
      snapshots: [
        { id: 's3', date: '2026-08-10', accounts: [{ id: 'b1', name: 'y', amount: 50000, currency: 'JPY' }] },
      ],
    }
    const series = combinedSnapshotSeries(mine, partner)
    expect(series.map((s) => s.date)).toEqual(['2026-08-01', '2026-08-10', '2026-08-15'])
    // 08-01: solo mio (100000); 08-10: mio (100000, sin foto nueva) + pareja (50000)
    expect(series[1].netJpy).toBe(100000 + 50000)
    // 08-15: mi foto nueva (120000) + ultima de la pareja (50000)
    expect(series[2].netJpy).toBe(120000 + 50000)
  })
})

describe('combinedProjectSavings', () => {
  it('vacio si ninguno de los dos tiene datos de prevision', () => {
    expect(combinedProjectSavings(emptyData(), emptyData(), [3, 6])).toEqual([])
  })

  it('suma los escenarios de los dos horizonte a horizonte', () => {
    const mine: AppData = {
      ...emptyData(new Date('2026-08-15T00:00:00')),
      settings: { ...emptyData().settings, defaultIncomeJpy: 250000, defaultLimitJpy: 150000 },
      snapshots: [{ id: 's1', date: '2026-08-01', accounts: [{ id: 'a', name: 'x', amount: 500000, currency: 'JPY' }] }],
    }
    const partner: AppData = {
      ...emptyData(new Date('2026-08-15T00:00:00')),
      settings: { ...emptyData().settings, defaultIncomeJpy: 200000, defaultLimitJpy: 100000 },
      snapshots: [{ id: 's2', date: '2026-08-01', accounts: [{ id: 'b', name: 'y', amount: 300000, currency: 'JPY' }] }],
    }
    const points = combinedProjectSavings(mine, partner, [3])
    // peor caso mio: 500000 + (250000-150000)*3 = 800000
    // peor caso pareja: 300000 + (200000-100000)*3 = 600000
    expect(points[0].worstCaseJpy).toBe(800000 + 600000)
  })
})

describe('combinedTopLabels', () => {
  it('suma lo que coincide por nombre entre los dos, con la categoria ya traducida', () => {
    const mine: AppData = {
      ...withMonth(),
      expenses: [
        { id: 'e1', monthId: '2026-08', categoryId: 'eating_out', label: 'uber', amount: 3000, kind: 'normal' },
        { id: 'e2', monthId: '2026-08', categoryId: 'eating_out', label: 'starbucks', amount: 500, kind: 'normal' },
      ],
    }
    const partner: AppData = {
      ...withMonth(),
      expenses: [
        { id: 'e3', monthId: '2026-08', categoryId: 'eating_out_p', label: 'Uber', amount: 2000, kind: 'normal' },
      ],
      categories: [{ id: 'eating_out_p', name: 'x', bucket: 'daily', colorSlot: 0 }],
    }
    const links: CategoryLink[] = [{ categoryId: 'eating_out', partnerCategoryId: 'eating_out_p' }]
    const out = combinedTopLabels(mine, partner, links, { limit: 10 })
    const uber = out.find((l) => l.label.toLowerCase() === 'uber')!
    expect(uber.totalJpy).toBe(3000 + 2000)
    expect(uber.count).toBe(2)
    // enlazada: cae bajo mi categoria, no aparte
    expect(uber.categoryId).toBe('mine:eating_out')
  })

  it('junta antes de recortar, para no perder lo que solo suma entre los dos', () => {
    const mine: AppData = {
      ...withMonth(),
      expenses: [{ id: 'e1', monthId: '2026-08', categoryId: 'eating_out', label: 'a', amount: 100, kind: 'normal' }],
    }
    const partner: AppData = {
      ...withMonth(),
      expenses: [{ id: 'e2', monthId: '2026-08', categoryId: 'eating_out', label: 'b', amount: 50, kind: 'normal' }],
    }
    const out = combinedTopLabels(mine, partner, [], { limit: 1 })
    expect(out).toHaveLength(1)
    expect(out[0].label).toBe('a')
  })
})

describe('combinedTopExpenses', () => {
  it('mezcla los gastos de los dos y recorta al limite ya combinado', () => {
    const mine: AppData = {
      ...withMonth(),
      expenses: [
        { id: 'e1', monthId: '2026-08', categoryId: 'eating_out', label: 'grande', amount: 9000, kind: 'normal' },
      ],
    }
    const partner: AppData = {
      ...withMonth(),
      expenses: [
        {
          id: 'e2',
          monthId: '2026-08',
          categoryId: 'eating_out',
          label: 'mas grande',
          amount: 15000,
          kind: 'normal',
        },
      ],
    }
    const out = combinedTopExpenses(mine, partner, [], { limit: 1 })
    expect(out).toHaveLength(1)
    expect(out[0].label).toBe('mas grande')
    expect(out[0].id).toBe('partner:e2')
    // sin enlace: la categoria de la pareja queda aparte, no bajo la mia
    expect(out[0].categoryId).toBe('partner:eating_out')
  })
})

describe('combinedNoCostItems', () => {
  it('mezcla los apuntes sin coste de los dos, mas reciente primero', () => {
    const mine: AppData = {
      ...withMonth(),
      expenses: [
        { id: 'e1', monthId: '2026-07', categoryId: 'home', label: 'regalo mio', amount: 3000, kind: 'noCost' },
      ],
    }
    const partner: AppData = {
      ...withMonth(),
      expenses: [
        { id: 'e2', monthId: '2026-08', categoryId: 'home', label: 'regalo pareja', amount: 2000, kind: 'noCost' },
      ],
    }
    const out = combinedNoCostItems(mine, partner, [])
    expect(out.map((e) => e.label)).toEqual(['regalo pareja', 'regalo mio'])
  })
})

describe('combinedMonthBurn y combinedDatedCount', () => {
  it('suma dia a dia el acumulado y el ritmo ideal (limite) de los dos', () => {
    const mine: AppData = {
      ...withMonth(),
      expenses: [
        { id: 'e1', monthId: '2026-08', categoryId: 'eating_out', label: 'x', amount: 1000, kind: 'normal', day: 5 },
      ],
    }
    const partner: AppData = {
      ...withMonth(),
      months: [{ id: '2026-08', rentJpy: 0, extras: [], fxRate: 0.0056, limitJpy: 62000, incomeJpy: 0 }],
      expenses: [
        { id: 'e2', monthId: '2026-08', categoryId: 'eating_out', label: 'y', amount: 2000, kind: 'normal', day: 5 },
      ],
    }
    const burn = combinedMonthBurn(mine, partner, '2026-08')
    const day5 = burn.find((b) => b.day === 5)!
    // mio: alquiler 80000 (dia 1) + 1000 (dia 5); pareja: 2000 (dia 5), sin alquiler
    expect(day5.cumulativeJpy).toBe(80000 + 1000 + 2000)
    // ritmo ideal: los dos limites juntos, repartidos linealmente
    expect(day5.paceJpy).toBeCloseTo(((150000 + 62000) * 5) / 31, 6)

    expect(combinedDatedCount(mine, partner, '2026-08')).toBe(2)
  })
})

describe('combinedYoy', () => {
  it('suma mes a mes; un lado cuenta aunque al otro le falte ese ano', () => {
    const mine: AppData = {
      ...emptyData(new Date('2026-08-15T00:00:00')),
      months: [
        { id: '2025-08', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 150000, incomeJpy: 0 },
        { id: '2026-08', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 150000, incomeJpy: 0 },
      ],
    }
    const partner: AppData = {
      ...emptyData(new Date('2026-08-15T00:00:00')),
      // solo tiene el ano en curso, no el anterior
      months: [{ id: '2026-08', rentJpy: 90000, extras: [], fxRate: 0.0056, limitJpy: 100000, incomeJpy: 0 }],
    }
    const yoy = combinedYoy(mine, partner, '2026-08', {})
    const august = yoy.points.find((p) => p.month === 8)!
    expect(august.currentJpy).toBe(80000 + 90000)
    expect(august.previousJpy).toBe(80000) // la pareja no tiene agosto 2025
    expect(yoy.comparable).toBe(1)
  })
})
