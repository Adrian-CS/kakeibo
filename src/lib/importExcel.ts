/**
 * Reconoce las hojas del Excel original y las convierte al modelo de la app.
 *
 * Formato esperado de cada hoja (fila 1 = cabeceras):
 *   [categoria] [importe] [=SUM(...)]  repetido para cada categoria
 * y en la columna A una lista de etiquetas con su valor debajo:
 *   家賃 / 為替相場 / 上限・バランス
 */
import { cellNumber, cellString, indexToCol, readXlsx, type SheetGrid } from './xlsx'
import type { Expense, FixedItem } from './types'
import { uid } from './id'

/** Cabeceras conocidas -> id de categoria. Se comparan en minusculas. */
const HEADER_ALIASES: Record<string, string> = {
  外食: 'eating_out',
  'comer fuera': 'eating_out',
  restaurantes: 'eating_out',
  'eating out': 'eating_out',
  スーパーマーケット: 'groceries',
  スーパー: 'groceries',
  supermercado: 'groceries',
  groceries: 'groceries',
  compra: 'groceries',
  服装と電車と毎月費消: 'fixed_transport',
  服装と電車と毎月の費消: 'fixed_transport',
  服装と電車と毎月消費: 'fixed_transport',
  服装と電車と毎月の消費: 'fixed_transport',
  'ropa y transporte': 'fixed_transport',
  transporte: 'fixed_transport',
  娯楽: 'leisure',
  ocio: 'leisure',
  leisure: 'leisure',
  部屋のもの: 'home',
  その他: 'home',
  'cosas de casa': 'home',
  casa: 'home',
  home: 'home',
}

const JP_DIGITS: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
}

/** '十二月' -> 12, '七月' -> 7, '26-7,8月' -> 8 (el ultimo de la lista). */
export function monthFromSheetName(name: string): { month: number | null; year: number | null } {
  const clean = name.trim()

  // ano en formato '26-' o '2026'
  let year: number | null = null
  const y4 = /(?:^|\D)(20\d{2})(?:\D|$)/.exec(clean)
  const y2 = /(?:^|\s)(\d{2})\s*-/.exec(clean)
  if (y4) year = Number(y4[1])
  else if (y2) year = 2000 + Number(y2[1])

  // meses en cifras antes de 月 ('7,8月' -> [7,8])
  const arabic = /((?:\d{1,2}\s*[,、･\-/]\s*)*\d{1,2})\s*月/.exec(clean)
  if (arabic) {
    const nums = arabic[1]
      .split(/[,、･\-/]/)
      .map((s) => Number(s.trim()))
      .filter((n) => n >= 1 && n <= 12)
    if (nums.length) return { month: nums[nums.length - 1], year }
  }

  // meses en kanji ('十二月', '一月')
  const kanji = /([一二三四五六七八九十]{1,3})\s*月/.exec(clean)
  if (kanji) {
    const s = kanji[1]
    let month: number | null = null
    if (s.length === 1) month = JP_DIGITS[s] ?? null
    else if (s[0] === '十') month = 10 + (JP_DIGITS[s[1]] ?? 0)
    else if (s[1] === '十') month = (JP_DIGITS[s[0]] ?? 0) * 10
    if (month && month >= 1 && month <= 12) return { month, year }
  }

  return { month: null, year }
}

/**
 * Elige el mes 'YYYY-MM' de una hoja. Si el nombre no lleva ano se asume
 * que la hoja pertenece a los doce meses anteriores a `reference`.
 */
export function guessMonthId(name: string, reference = new Date()): string | null {
  const { month, year } = monthFromSheetName(name)
  if (!month) return null
  if (year) return `${year}-${String(month).padStart(2, '0')}`
  const refY = reference.getFullYear()
  const refM = reference.getMonth() + 1
  const y = month > refM ? refY - 1 : refY
  return `${y}-${String(month).padStart(2, '0')}`
}

export interface ParsedItem {
  categoryId: string
  label: string
  amount: number
}

export interface ParsedSheet {
  sheetName: string
  monthId: string | null
  items: ParsedItem[]
  rentJpy: number | null
  fxRate: number | null
  limitJpy: number | null
  extras: FixedItem[]
  notes: string[]
  totalJpy: number
}

/** Busca una etiqueta en la columna A y devuelve el primer numero debajo. */
function labelValue(grid: SheetGrid, labels: string[], lookahead = 3): number | null {
  for (let row = 1; row <= Math.min(grid.maxRow, 80); row++) {
    const v = cellString(grid, 0, row).trim()
    if (!labels.includes(v)) continue
    for (let r = row + 1; r <= row + lookahead; r++) {
      const n = cellNumber(grid, 0, r)
      if (n !== null) return n
      // formulas del tipo '=242000+30000' o '=4494+2023+2905'
      const s = cellString(grid, 0, r)
      if (/^=[\d\s\u3000+.]+$/.test(s)) {
        const nums = s.slice(1).match(/\d+(?:\.\d+)?/g)
        if (nums) return nums.reduce((a, b) => a + Number(b), 0)
      }
    }
  }
  return null
}

/** Texto libre de la columna A por debajo de la fila 17 (las notas del Excel). */
function collectNotes(grid: SheetGrid): string[] {
  const out: string[] = []
  for (let row = 16; row <= Math.min(grid.maxRow, 80); row++) {
    const s = cellString(grid, 0, row).trim()
    if (!s || s.startsWith('=')) continue
    if (['上限・バランス', '為替相場', '家賃'].includes(s)) continue
    if (s.length < 4) continue
    out.push(s)
  }
  return out
}

export function parseSheet(grid: SheetGrid, reference = new Date()): ParsedSheet {
  // 1) localizar las columnas de categoria en la fila 1
  const columns: { categoryId: string; col: number }[] = []
  for (let col = 0; col <= grid.maxCol; col++) {
    const header = cellString(grid, col, 1).trim().toLowerCase()
    const id = HEADER_ALIASES[header]
    if (id) columns.push({ categoryId: id, col })
  }

  // 2) leer las filas de cada categoria (nombre en col, importe en col+1)
  const items: ParsedItem[] = []
  for (const { categoryId, col } of columns) {
    for (let row = 2; row <= grid.maxRow; row++) {
      const amount = cellNumber(grid, col + 1, row)
      if (amount === null || amount === 0) continue
      const label = cellString(grid, col, row).trim()
      items.push({ categoryId, label, amount })
    }
  }

  // 3) extras suelto en la fila 1: cabecera de texto con un numero al lado
  //    (p. ej. 'hotel' 116600) que no sea una columna de categoria
  const used = new Set<number>()
  for (const { col } of columns) {
    used.add(col)
    used.add(col + 1)
    used.add(col + 2)
  }
  const extras: FixedItem[] = []
  for (let col = 1; col < grid.maxCol; col++) {
    if (used.has(col)) continue
    const label = cellString(grid, col, 1).trim()
    const amount = cellNumber(grid, col + 1, 1)
    if (!label || label === '合計' || amount === null) continue
    extras.push({ id: uid('x'), label, amount })
    used.add(col)
    used.add(col + 1)
  }

  const rentJpy = labelValue(grid, ['家賃', 'alquiler', 'Alquiler'])
  const fxRate = labelValue(grid, ['為替相場', 'tipo de cambio'])
  const rawLimit = labelValue(grid, ['上限・バランス', '上限', 'limite', 'límite'])
  // en las hojas antiguas el limite estaba en euros; lo pasamos a yenes
  const limitJpy =
    rawLimit === null
      ? null
      : rawLimit < 20000 && fxRate && fxRate > 0
        ? Math.round(rawLimit / fxRate)
        : rawLimit

  return {
    sheetName: grid.name,
    monthId: guessMonthId(grid.name, reference),
    items,
    rentJpy,
    fxRate,
    limitJpy,
    extras,
    notes: collectNotes(grid),
    totalJpy: items.reduce((a, b) => a + b.amount, 0),
  }
}

export interface ParseResult {
  sheets: ParsedSheet[]
  /** hojas sin ninguna cabecera reconocida */
  skipped: string[]
}

export function parseWorkbook(buf: Uint8Array, reference = new Date()): ParseResult {
  const grids = readXlsx(buf)
  const sheets: ParsedSheet[] = []
  const skipped: string[] = []
  for (const g of grids) {
    const parsed = parseSheet(g, reference)
    // una hoja vacia o una plantilla no aporta nada
    if (parsed.items.length === 0) skipped.push(g.name)
    else sheets.push(parsed)
  }
  sheets.sort((a, b) => (a.monthId ?? 'zzzz').localeCompare(b.monthId ?? 'zzzz'))
  return { sheets, skipped }
}

/** Convierte una hoja ya asignada a un mes en gastos de la app. */
export function toExpenses(sheet: ParsedSheet, monthId: string): Expense[] {
  return sheet.items.map((it) => ({
    id: uid('e'),
    monthId,
    categoryId: it.categoryId,
    label: it.label,
    amount: it.amount,
    kind: 'normal' as const,
  }))
}

/** Nombre legible de la columna de una categoria (para depurar). */
export function columnLabel(col: number): string {
  return indexToCol(col)
}
