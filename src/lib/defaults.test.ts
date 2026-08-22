import { describe, expect, it } from 'vitest'
import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS, newMonth } from './defaults'
import { categoryLabel } from './calc'

describe('newMonth', () => {
  it('sin facturas fijas por defecto, arranca con los extras vacios', () => {
    const m = newMonth('2026-08', DEFAULT_SETTINGS)
    expect(m.extras).toEqual([])
    expect(m.rentJpy).toBe(DEFAULT_SETTINGS.defaultRentJpy)
  })

  it('copia la plantilla de facturas fijas por defecto, con ids nuevos', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      defaultExtras: [
        { id: 'plantilla-agua', label: 'agua', amount: 3000 },
        { id: 'plantilla-luz', label: 'luz', amount: 5000 },
      ],
    }
    const m = newMonth('2026-08', settings)
    expect(m.extras.map((x) => x.label)).toEqual(['agua', 'luz'])
    expect(m.extras.map((x) => x.amount)).toEqual([3000, 5000])
    // cada mes tiene que llevar sus propios ids, no compartir los de la plantilla
    expect(m.extras.every((x) => !x.id.startsWith('plantilla-'))).toBe(true)

    const other = newMonth('2026-09', settings)
    expect(new Set([...m.extras, ...other.extras].map((x) => x.id)).size).toBe(4)
  })

  it('arranca con el ingreso previsto por defecto de ajustes', () => {
    expect(newMonth('2026-08', DEFAULT_SETTINGS).incomeJpy).toBe(0)
    const settings = { ...DEFAULT_SETTINGS, defaultIncomeJpy: 280000 }
    expect(newMonth('2026-08', settings).incomeJpy).toBe(280000)
  })
})

describe('DEFAULT_CATEGORIES', () => {
  it('en japones, una cuenta nueva ve las cinco categorias del Excel original en japones', () => {
    const names = DEFAULT_CATEGORIES.map((c) => categoryLabel(c, 'ja'))
    expect(names).toEqual(['外食', 'スーパーマーケット', '服装と電車と毎月消費', '娯楽', '部屋のもの'])
  })
})
