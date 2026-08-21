import { describe, expect, it, vi } from 'vitest'
import { fetchFxRate, fxUrl, needsFxUpdate, parseFxResponse, today } from './fx'

function okJson(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body } as unknown as Response
}

describe('parseFxResponse', () => {
  it('lee la cotizacion', () => {
    const r = parseFxResponse({ base: 'JPY', date: '2026-08-20', rates: { EUR: 0.0056 } }, 'EUR')
    expect(r).toEqual({ rate: 0.0056, date: '2026-08-20', currency: 'EUR' })
  })

  it('protesta si falta la moneda', () => {
    expect(() => parseFxResponse({ rates: { USD: 0.007 } }, 'EUR')).toThrow(/EUR/)
    expect(() => parseFxResponse({}, 'EUR')).toThrow()
    expect(() => parseFxResponse(null, 'EUR')).toThrow()
  })

  it('protesta si la base no es el yen', () => {
    expect(() => parseFxResponse({ base: 'USD', rates: { EUR: 0.9 } }, 'EUR')).toThrow(/JPY/)
  })

  it('rechaza cotizaciones absurdas', () => {
    expect(() => parseFxResponse({ rates: { EUR: 0 } }, 'EUR')).toThrow()
    expect(() => parseFxResponse({ rates: { EUR: -1 } }, 'EUR')).toThrow()
  })
})

describe('fetchFxRate', () => {
  it('pide el cambio con el yen como base', async () => {
    const f = vi.fn().mockResolvedValue(okJson({ base: 'JPY', date: '2026-08-20', rates: { EUR: 0.0056 } }))
    const r = await fetchFxRate('EUR', f)
    expect(f.mock.calls[0][0]).toContain('base=JPY')
    expect(f.mock.calls[0][0]).toContain('EUR')
    expect(r.rate).toBe(0.0056)
  })

  it('si el primer dominio falla prueba el segundo', async () => {
    const f = vi
      .fn()
      .mockRejectedValueOnce(new Error('sin red'))
      .mockResolvedValueOnce(okJson({ base: 'JPY', date: '2026-08-20', rates: { EUR: 0.0057 } }))
    expect((await fetchFxRate('EUR', f)).rate).toBe(0.0057)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('si fallan los dos, lanza', async () => {
    const f = vi.fn().mockResolvedValue(okJson({}, false))
    await expect(fetchFxRate('EUR', f)).rejects.toThrow()
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('la url lleva los dos formatos de parametro', () => {
    const u = fxUrl('https://api.frankfurter.dev/v1', 'EUR')
    expect(u).toContain('symbols=EUR')
    expect(u).toContain('to=EUR')
  })
})

describe('una consulta al dia', () => {
  it('today con ceros', () => {
    expect(today(new Date('2026-01-05T22:00:00'))).toBe('2026-01-05')
  })

  it('solo hace falta si no se consulto hoy', () => {
    const now = new Date('2026-08-20T09:00:00')
    expect(needsFxUpdate(undefined, now)).toBe(true)
    expect(needsFxUpdate('2026-08-19', now)).toBe(true)
    expect(needsFxUpdate('2026-08-20', now)).toBe(false)
  })
})
