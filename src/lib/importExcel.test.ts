import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { guessMonthId, monthFromSheetName, parseWorkbook, toExpenses } from './importExcel'
import { colToIndex, decodeXml, indexToCol, parseRef, readXlsx } from './xlsx'

const FIXTURE = join(__dirname, '../test/fixtures/sample.xlsx')
const buf = new Uint8Array(readFileSync(FIXTURE))

describe('nombres de hoja', () => {
  it('lee meses en cifras y en kanji', () => {
    expect(monthFromSheetName('26-3月の費消 1')).toEqual({ month: 3, year: 2026 })
    expect(monthFromSheetName('十二月')).toEqual({ month: 12, year: null })
    expect(monthFromSheetName('十一月の費消')).toEqual({ month: 11, year: null })
    expect(monthFromSheetName('七月の費消')).toEqual({ month: 7, year: null })
    expect(monthFromSheetName(' 五月の費消')).toEqual({ month: 5, year: null })
    expect(monthFromSheetName('月の費消')).toEqual({ month: null, year: null })
  })

  it('con varios meses toma el ultimo', () => {
    expect(monthFromSheetName('26-7,8月の費消')).toEqual({ month: 8, year: 2026 })
  })

  it('sin ano asume los doce meses anteriores', () => {
    const ref = new Date('2026-08-20T00:00:00')
    expect(guessMonthId('八月の費消', ref)).toBe('2026-08')
    expect(guessMonthId('十二月', ref)).toBe('2025-12')
    expect(guessMonthId('三月の費消', ref)).toBe('2026-03')
    expect(guessMonthId('九月の費消', ref)).toBe('2025-09')
    expect(guessMonthId('26-1月の費消 1', ref)).toBe('2026-01')
  })
})

describe('lector de xlsx', () => {
  it('descodifica entidades XML', () => {
    expect(decodeXml('a &amp; b &lt;c&gt; &#65; &#x42;')).toBe('a & b <c> A B')
  })

  it('convierte columnas a indices', () => {
    expect(colToIndex('A')).toBe(0)
    expect(colToIndex('Z')).toBe(25)
    expect(colToIndex('AA')).toBe(26)
    expect(indexToCol(0)).toBe('A')
    expect(indexToCol(26)).toBe('AA')
    expect(parseRef('C12')).toEqual({ col: 2, row: 12 })
    expect(parseRef('nope')).toBeNull()
  })

  it('lee las hojas del libro', () => {
    const sheets = readXlsx(buf)
    expect(sheets.map((s) => s.name)).toEqual(['26-3月の費消', '十二月', 'plantilla vacia'])
    const first = sheets[0]
    expect(first.cells.get('B1')).toBe('外食')
    expect(first.cells.get('C2')).toBe(1000)
  })
})

describe('importacion del libro', () => {
  const result = parseWorkbook(buf, new Date('2026-08-20T00:00:00'))

  it('descarta las hojas plantilla', () => {
    expect(result.skipped).toContain('plantilla vacia')
    expect(result.sheets.map((s) => s.sheetName)).toEqual(['十二月', '26-3月の費消'])
  })

  it('asigna el mes a cada hoja', () => {
    const march = result.sheets.find((s) => s.sheetName === '26-3月の費消')!
    expect(march.monthId).toBe('2026-03')
    expect(result.sheets.find((s) => s.sheetName === '十二月')!.monthId).toBe('2025-12')
  })

  it('lee las cinco categorias con sus importes', () => {
    const march = result.sheets.find((s) => s.sheetName === '26-3月の費消')!
    expect(march.items).toHaveLength(8)
    const byCat = (id: string) =>
      march.items.filter((i) => i.categoryId === id).reduce((a, b) => a + b.amount, 0)
    expect(byCat('eating_out')).toBe(3000)
    expect(byCat('groceries')).toBe(3500)
    expect(byCat('fixed_transport')).toBe(11590)
    expect(byCat('leisure')).toBe(2080)
    expect(byCat('home')).toBe(22990)
    expect(march.totalJpy).toBe(43160)
  })

  it('lee alquiler, tipo de cambio y limite', () => {
    const march = result.sheets.find((s) => s.sheetName === '26-3月の費消')!
    expect(march.rentJpy).toBe(82000)
    expect(march.fxRate).toBe(0.0056)
    expect(march.limitJpy).toBe(200000)
  })

  it('convierte a yenes un limite escrito en euros', () => {
    // en las hojas antiguas el limite estaba en euros: 1300 / 0.0056 = 232143 ¥
    const dic = result.sheets.find((s) => s.sheetName === '十二月')!
    expect(dic.limitJpy).toBe(Math.round(1300 / 0.0056))
    expect(dic.rentJpy).toBe(91000)
    // un limite ya en yenes se deja igual
    const march = result.sheets.find((s) => s.sheetName === '26-3月の費消')!
    expect(march.limitJpy).toBe(200000)
  })

  it('recoge los extras sueltos de la fila 1', () => {
    const march = result.sheets.find((s) => s.sheetName === '26-3月の費消')!
    expect(march.extras.map((x) => ({ label: x.label, amount: x.amount }))).toEqual([
      { label: 'hotel', amount: 5000 },
    ])
  })

  it('guarda las notas de la columna A', () => {
    const march = result.sheets.find((s) => s.sheetName === '26-3月の費消')!
    expect(march.notes).toContain('nota de prueba en la hoja')
  })

  it('convierte una hoja en gastos con el mes asignado', () => {
    const march = result.sheets.find((s) => s.sheetName === '26-3月の費消')!
    const expenses = toExpenses(march, '2026-03')
    expect(expenses).toHaveLength(8)
    expect(new Set(expenses.map((e) => e.monthId))).toEqual(new Set(['2026-03']))
    expect(new Set(expenses.map((e) => e.id)).size).toBe(8)
    expect(expenses.every((e) => e.kind === 'normal')).toBe(true)
  })
})
