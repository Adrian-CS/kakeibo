import { beforeEach, describe, expect, it } from 'vitest'
import { clearData, deserialize, exportFileName, loadData, migrate, saveData, serialize, STORAGE_KEY } from './storage'
import { emptyData } from './defaults'

describe('persistencia', () => {
  beforeEach(() => localStorage.clear())

  it('sin datos guardados devuelve un estado vacio usable', () => {
    const d = loadData()
    expect(d.categories.length).toBe(5)
    expect(d.expenses).toEqual([])
    expect(d.months.length).toBe(1)
  })

  it('guarda y recupera', () => {
    const d = emptyData()
    d.expenses.push({
      id: 'e1',
      monthId: '2026-08',
      categoryId: 'eating_out',
      label: 'uber',
      amount: 1500,
      kind: 'normal',
    })
    expect(saveData(d)).toBe(true)
    expect(loadData().expenses).toHaveLength(1)
  })

  it('un JSON corrupto no rompe la carga', () => {
    localStorage.setItem(STORAGE_KEY, '{no es json')
    expect(loadData().expenses).toEqual([])
  })

  it('borra', () => {
    saveData(emptyData())
    clearData()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

describe('migracion', () => {
  it('rellena lo que falte de una copia antigua', () => {
    const d = migrate({ expenses: [{ id: 'a', monthId: '2026-01', categoryId: 'x', label: 'l', amount: 5 }] })
    expect(d.expenses[0].kind).toBe('normal')
    expect(d.categories.length).toBe(5)
    expect(d.settings.lang).toBe('es')
    expect(d.snapshots).toEqual([])
  })

  it('una copia sin defaultExtras (de antes de que existiera) no rompe la carga', () => {
    const d = migrate({ settings: { lang: 'es', defaultRentJpy: 90000 } })
    expect(d.settings.defaultExtras).toEqual([])
    expect(d.settings.defaultRentJpy).toBe(90000)
  })

  it('descarta apuntes sin importe o sin mes', () => {
    const d = migrate({
      expenses: [
        { id: 'a', monthId: '2026-01', categoryId: 'x', label: 'ok', amount: 5 },
        { id: 'b', categoryId: 'x', label: 'sin mes', amount: 5 },
        { id: 'c', monthId: '2026-01', categoryId: 'x', label: 'sin importe' },
      ],
    })
    expect(d.expenses.map((e) => e.label)).toEqual(['ok'])
  })

  it('acepta basura sin lanzar', () => {
    expect(migrate(null).categories.length).toBe(5)
    expect(migrate('texto').expenses).toEqual([])
    expect(migrate(42).months.length).toBe(1)
  })

  it('el ciclo exportar/importar conserva los datos', () => {
    const d = emptyData()
    d.snapshots.push({
      id: 's',
      date: '2026-08-01',
      accounts: [{ id: 'a', name: 'smbc', amount: 100, currency: 'JPY' }],
    })
    const back = deserialize(serialize(d))
    expect(back.snapshots[0].accounts[0].name).toBe('smbc')
  })

  it('el nombre del fichero lleva la fecha', () => {
    expect(exportFileName(new Date('2026-08-20T10:00:00'))).toBe('kakeibo-20260820.json')
  })
})
