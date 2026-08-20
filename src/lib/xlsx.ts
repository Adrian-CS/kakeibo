/**
 * Lector minimo de .xlsx (solo lectura, sin dependencias pesadas).
 *
 * Un .xlsx es un zip con XML dentro. Solo necesitamos los valores de las
 * celdas, asi que descomprimimos con fflate y parseamos el XML con
 * expresiones regulares: es suficiente para los ficheros que genera Excel /
 * Google Sheets y evita cargar una libreria de 900 kB en el movil.
 */
import { unzipSync, strFromU8 } from 'fflate'

export type CellValue = string | number

export interface SheetGrid {
  name: string
  /** clave 'A1' -> valor */
  cells: Map<string, CellValue>
  maxRow: number
  maxCol: number
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

export function decodeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (m, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) {
      return String.fromCodePoint(parseInt(code.slice(2), 16))
    }
    if (code.startsWith('#')) return String.fromCodePoint(parseInt(code.slice(1), 10))
    return ENTITIES[code] ?? m
  })
}

/** 'A' -> 0, 'Z' -> 25, 'AA' -> 26 */
export function colToIndex(col: string): number {
  let n = 0
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** 0 -> 'A', 26 -> 'AA' */
export function indexToCol(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - r) / 26)
  }
  return s
}

export function parseRef(ref: string): { col: number; row: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)
  if (!m) return null
  return { col: colToIndex(m[1]), row: Number(m[2]) }
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = []
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g
  let m: RegExpExecArray | null
  while ((m = siRe.exec(xml))) {
    const inner = m[1] ?? ''
    let text = ''
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g
    let t: RegExpExecArray | null
    while ((t = tRe.exec(inner))) text += decodeXml(t[1])
    out.push(text)
  }
  return out
}

function parseSheet(xml: string, shared: string[], name: string): SheetGrid {
  const cells = new Map<string, CellValue>()
  let maxRow = 0
  let maxCol = 0
  const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
  let m: RegExpExecArray | null
  while ((m = cRe.exec(xml))) {
    const attrs = m[1] ?? ''
    const inner = m[2] ?? ''
    const refM = /\br="([A-Z]+\d+)"/.exec(attrs)
    if (!refM) continue
    const ref = refM[1]
    const typeM = /\bt="([a-zA-Z]+)"/.exec(attrs)
    const type = typeM?.[1] ?? 'n'

    let value: CellValue | null = null
    if (type === 'inlineStr') {
      const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g
      let text = ''
      let t: RegExpExecArray | null
      while ((t = tRe.exec(inner))) text += decodeXml(t[1])
      value = text
    } else {
      const vM = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)
      if (vM) {
        const raw = decodeXml(vM[1])
        if (type === 's') {
          const idx = Number(raw)
          value = shared[idx] ?? ''
        } else if (type === 'str' || type === 'e') {
          value = raw
        } else if (type === 'b') {
          value = raw === '1' ? 'TRUE' : 'FALSE'
        } else {
          const n = Number(raw)
          value = Number.isFinite(n) ? n : raw
        }
      }
    }
    if (value === null || value === '') continue
    cells.set(ref, value)
    const p = parseRef(ref)
    if (p) {
      if (p.row > maxRow) maxRow = p.row
      if (p.col > maxCol) maxCol = p.col
    }
  }
  return { name, cells, maxRow, maxCol }
}

/** Lee un .xlsx y devuelve las hojas en el orden del libro. */
export function readXlsx(buf: Uint8Array): SheetGrid[] {
  const files = unzipSync(buf)

  const get = (path: string): string | null => {
    const f = files[path]
    return f ? strFromU8(f) : null
  }

  const shared = (() => {
    const xml = get('xl/sharedStrings.xml')
    return xml ? parseSharedStrings(xml) : []
  })()

  // rId -> ruta del worksheet
  const relsXml = get('xl/_rels/workbook.xml.rels') ?? ''
  const rels = new Map<string, string>()
  const relRe = /<Relationship\b([^>]*)\/>/g
  let rm: RegExpExecArray | null
  while ((rm = relRe.exec(relsXml))) {
    const attrs = rm[1]
    const id = /\bId="([^"]+)"/.exec(attrs)?.[1]
    let target = /\bTarget="([^"]+)"/.exec(attrs)?.[1]
    if (!id || !target) continue
    target = target.replace(/^\/?xl\//, '').replace(/^\.\//, '')
    rels.set(id, `xl/${target}`)
  }

  const wbXml = get('xl/workbook.xml') ?? ''
  const sheets: SheetGrid[] = []
  const sheetRe = /<sheet\b([^>]*)\/>/g
  let sm: RegExpExecArray | null
  let fallbackIndex = 0
  while ((sm = sheetRe.exec(wbXml))) {
    const attrs = sm[1]
    const name = decodeXml(/\bname="([^"]*)"/.exec(attrs)?.[1] ?? '')
    const rid = /\br:id="([^"]+)"/.exec(attrs)?.[1] ?? /\bid="([^"]+)"/.exec(attrs)?.[1]
    fallbackIndex += 1
    const path = (rid && rels.get(rid)) || `xl/worksheets/sheet${fallbackIndex}.xml`
    const xml = get(path)
    if (!xml) continue
    sheets.push(parseSheet(xml, shared, name))
  }
  return sheets
}

/* Ayudas de lectura de una hoja ya parseada */

export function cell(grid: SheetGrid, col: number, row: number): CellValue | undefined {
  return grid.cells.get(`${indexToCol(col)}${row}`)
}

export function cellString(grid: SheetGrid, col: number, row: number): string {
  const v = cell(grid, col, row)
  return typeof v === 'string' ? v : v === undefined ? '' : String(v)
}

export function cellNumber(grid: SheetGrid, col: number, row: number): number | null {
  const v = cell(grid, col, row)
  return typeof v === 'number' ? v : null
}
