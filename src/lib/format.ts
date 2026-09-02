import type { Lang } from './types'

const LOCALE: Record<Lang, string> = { es: 'es-ES', ja: 'ja-JP', en: 'en-GB' }

export function localeOf(lang: Lang): string {
  return LOCALE[lang] ?? 'es-ES'
}

/** 12345 -> "12.345 ¥" (segun idioma). Sin decimales. */
export function fmtJpy(n: number, lang: Lang = 'es'): string {
  const v = Math.round(n)
  return new Intl.NumberFormat(localeOf(lang), {
    style: 'currency',
    currency: 'JPY',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  }).format(v)
}

export function fmtMoney(n: number, currency: string, lang: Lang = 'es'): string {
  const digits = currency === 'JPY' ? 0 : 2
  return new Intl.NumberFormat(localeOf(lang), {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(currency === 'JPY' ? Math.round(n) : n)
}

export function fmtNumber(n: number, lang: Lang = 'es', digits = 0): string {
  return new Intl.NumberFormat(localeOf(lang), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n)
}

/** 123456 -> "123 mil" / "1,2 M" para ejes y tarjetas. */
export function fmtCompact(n: number, lang: Lang = 'es'): string {
  return new Intl.NumberFormat(localeOf(lang), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n)
}

export function fmtPercent(ratio: number, lang: Lang = 'es', digits = 0): string {
  return new Intl.NumberFormat(localeOf(lang), {
    style: 'percent',
    maximumFractionDigits: digits,
    signDisplay: 'auto',
  }).format(ratio)
}

export function fmtSignedPercent(ratio: number, lang: Lang = 'es', digits = 0): string {
  return new Intl.NumberFormat(localeOf(lang), {
    style: 'percent',
    maximumFractionDigits: digits,
    signDisplay: 'exceptZero',
  }).format(ratio)
}

/** '2026-08' -> "ago 2026" / "2026年8月". */
export function fmtMonth(monthId: string, lang: Lang = 'es', long = false): string {
  const [y, m] = monthId.split('-').map(Number)
  if (!y || !m) return monthId
  if (lang === 'ja') return `${y}年${m}月`
  const d = new Date(y, m - 1, 1)
  const label = new Intl.DateTimeFormat(localeOf(lang), { month: long ? 'long' : 'short' }).format(d)
  return `${label} ${y}`
}

/** Etiqueta corta para el eje X: "ago" o "ago 26" en enero. */
export function fmtMonthAxis(monthId: string, lang: Lang = 'es'): string {
  const [y, m] = monthId.split('-').map(Number)
  if (!y || !m) return monthId
  if (lang === 'ja') return m === 1 ? `${y}年1月` : `${m}月`
  const d = new Date(y, m - 1, 1)
  const label = new Intl.DateTimeFormat(localeOf(lang), { month: 'short' }).format(d)
  return m === 1 ? `${label} ${String(y).slice(2)}` : label
}

export function fmtDate(iso: string, lang: Lang = 'es'): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(localeOf(lang), { dateStyle: 'medium' }).format(d)
}

/** Fecha y hora de un ISO completo (con hora), tipo "20 ago 2026 10:15". */
export function fmtWhen(iso: string | undefined, lang: Lang = 'es'): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const time = new Intl.DateTimeFormat(localeOf(lang), { hour: '2-digit', minute: '2-digit' }).format(d)
  return `${fmtDate(iso.slice(0, 10), lang)} ${time}`
}

/** Lee un importe escrito a mano: "1.200", "1,200", "1 200 ¥", "12.5". */
export function parseAmount(raw: string): number | null {
  const s = raw.replace(/[^\d.,-]/g, '').trim()
  if (!s) return null
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  let normalized = s
  if (lastComma > -1 && lastDot > -1) {
    // el ultimo separador es el decimal
    const decSep = lastComma > lastDot ? ',' : '.'
    const thouSep = decSep === ',' ? '.' : ','
    normalized = s.split(thouSep).join('').replace(decSep, '.')
  } else if (lastComma > -1) {
    const decimals = s.length - lastComma - 1
    normalized = decimals === 3 ? s.split(',').join('') : s.replace(',', '.')
  } else if (lastDot > -1) {
    const decimals = s.length - lastDot - 1
    normalized = decimals === 3 ? s.split('.').join('') : s
  }
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

/**
 * Invierte el signo de un importe escrito a mano, sin tocar el resto del
 * texto. Hace falta porque el teclado numerico que abren los campos de
 * importe en movil (`inputMode="decimal"`) normalmente no tiene tecla de
 * signo menos, asi que un boton es la unica forma de apuntar algo en
 * negativo (un reintegro recurrente, por ejemplo) desde el telefono.
 */
export function toggleSign(raw: string): string {
  const s = raw.trim()
  if (!s) return s
  return s.startsWith('-') ? s.slice(1) : `-${s}`
}
