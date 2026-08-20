import { describe, expect, it } from 'vitest'
import { niceTicks } from './charts'

describe('niceTicks', () => {
  it('siempre llega por encima del maximo', () => {
    for (const max of [1, 7, 99, 100, 283742, 968942, 1_234_567, 0.42]) {
      const t = niceTicks(max)
      expect(t[0]).toBe(0)
      expect(t[t.length - 1]).toBeGreaterThanOrEqual(max)
      expect(t.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('usa pasos redondos', () => {
    expect(niceTicks(200000)).toEqual([0, 50000, 100000, 150000, 200000])
    expect(niceTicks(283742)).toEqual([0, 100000, 200000, 300000])
  })

  it('los pasos son uniformes', () => {
    const t = niceTicks(968942)
    const step = t[1] - t[0]
    for (let i = 1; i < t.length; i++) expect(t[i] - t[i - 1]).toBeCloseTo(step, 6)
  })

  it('con maximo cero devuelve una escala usable', () => {
    expect(niceTicks(0)).toEqual([0, 1])
    expect(niceTicks(-5)).toEqual([0, 1])
  })
})
