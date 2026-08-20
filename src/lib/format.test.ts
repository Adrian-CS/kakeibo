import { describe, expect, it } from 'vitest'
import { fmtMonth, fmtMonthAxis, fmtPercent, fmtSignedPercent, parseAmount } from './format'

describe('parseAmount', () => {
  it('lee numeros sencillos', () => {
    expect(parseAmount('1200')).toBe(1200)
    expect(parseAmount('0')).toBe(0)
    expect(parseAmount('-500')).toBe(-500)
  })

  it('acepta separadores de miles en los dos formatos', () => {
    expect(parseAmount('1.200')).toBe(1200)
    expect(parseAmount('1,200')).toBe(1200)
    expect(parseAmount('12.345.678')).toBe(12345678)
  })

  it('distingue el decimal del separador de miles', () => {
    expect(parseAmount('0,0056')).toBeCloseTo(0.0056, 10)
    expect(parseAmount('0.0056')).toBeCloseTo(0.0056, 10)
    expect(parseAmount('1.234,56')).toBeCloseTo(1234.56, 10)
    expect(parseAmount('1,234.56')).toBeCloseTo(1234.56, 10)
  })

  it('ignora simbolos y espacios', () => {
    expect(parseAmount('1 200 ¥')).toBe(1200)
    expect(parseAmount('¥ 980')).toBe(980)
    expect(parseAmount('12,5 €')).toBeCloseTo(12.5, 10)
  })

  it('devuelve null si no hay numero', () => {
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('  ')).toBeNull()
  })
})

describe('formato de meses', () => {
  it('escribe el mes en cada idioma', () => {
    expect(fmtMonth('2026-08', 'ja')).toBe('2026年8月')
    expect(fmtMonth('2026-08', 'es')).toMatch(/2026/)
    expect(fmtMonth('mal', 'es')).toBe('mal')
  })

  it('en el eje solo pone el ano en enero', () => {
    expect(fmtMonthAxis('2026-01', 'ja')).toBe('2026年1月')
    expect(fmtMonthAxis('2026-05', 'ja')).toBe('5月')
    expect(fmtMonthAxis('2026-01', 'en')).toMatch(/26$/)
    expect(fmtMonthAxis('2026-05', 'en')).not.toMatch(/26$/)
  })
})

describe('porcentajes', () => {
  it('formatea con y sin signo', () => {
    expect(fmtPercent(0.4321, 'en')).toBe('43%')
    expect(fmtSignedPercent(0.12, 'en')).toBe('+12%')
    expect(fmtSignedPercent(-0.12, 'en')).toBe('-12%')
  })
})
