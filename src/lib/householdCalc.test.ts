import { describe, expect, it } from 'vitest'
import {
  combinedCategories,
  combinedMonthTotals,
  combinedProjectSavings,
  combinedSnapshotSeries,
  combinedStats,
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
