/**
 * Tipo de cambio desde Frankfurter (datos del Banco Central Europeo).
 * API publica, sin clave y con CORS abierto. Se actualiza una vez al dia en
 * dias laborables, que para llevar los gastos sobra.
 */
export interface FxResult {
  /** 1 JPY = rate <moneda> */
  rate: number
  /** fecha de la cotizacion, 'YYYY-MM-DD' */
  date: string
  currency: string
}

const HOSTS = ['https://api.frankfurter.dev/v1', 'https://api.frankfurter.app']

export function fxUrl(host: string, currency: string): string {
  return `${host}/latest?base=JPY&symbols=${currency}&from=JPY&to=${currency}`
}

/** Lee la respuesta de la API. Las dos versiones devuelven `rates`. */
export function parseFxResponse(body: unknown, currency: string): FxResult {
  const b = (body ?? {}) as { rates?: Record<string, number>; date?: string; base?: string }
  const rate = b.rates?.[currency]
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`sin cotizacion para ${currency}`)
  }
  if (b.base && b.base !== 'JPY') throw new Error(`la respuesta no viene en JPY (${b.base})`)
  return { rate, date: b.date ?? '', currency }
}

/**
 * Devuelve el cambio 1 JPY -> `currency`. Prueba los dos dominios porque el
 * servicio esta migrando de .app a .dev y conviene que siga funcionando
 * cuando uno de los dos se apague.
 */
export async function fetchFxRate(
  currency: string,
  f: typeof fetch = fetch,
): Promise<FxResult> {
  let last: unknown = null
  for (const host of HOSTS) {
    try {
      const res = await f(fxUrl(host, currency), { headers: { Accept: 'application/json' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return parseFxResponse(await res.json(), currency)
    } catch (e) {
      last = e
    }
  }
  throw last instanceof Error ? last : new Error('no se ha podido consultar el cambio')
}

/** 'YYYY-MM-DD' de hoy, para no consultar dos veces el mismo dia. */
export function today(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

export function needsFxUpdate(fxUpdatedAt: string | undefined, now = new Date()): boolean {
  return fxUpdatedAt !== today(now)
}
