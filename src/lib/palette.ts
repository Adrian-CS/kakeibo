/**
 * Paleta de datos validada (checks de banda de luminosidad, croma, separacion
 * para daltonismo y contraste). El orden de los slots es fijo: nunca se cicla
 * ni se reasigna por ranking, para que un color signifique siempre lo mismo.
 *
 * Verificado con el validador de la guia de dataviz:
 *   claro: peor par adyacente CVD ΔE 9.1 · vision normal ΔE 19.6
 * Tres slots claros (aqua, amarillo, magenta) quedan por debajo de 3:1 sobre
 * la superficie clara: por eso todos los graficos llevan leyenda, etiquetas
 * visibles y vista de tabla.
 */
export const SERIES_LIGHT = [
  '#2a78d6', // 1 azul
  '#eb6834', // 2 naranja
  '#1baf7a', // 3 aqua
  '#eda100', // 4 amarillo
  '#e87ba4', // 5 magenta
  '#008300', // 6 verde
  '#4a3aa7', // 7 violeta
  '#e34948', // 8 rojo
] as const

export const SERIES_DARK = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
] as const

export const MAX_SLOTS = SERIES_LIGHT.length

/** Color de un slot (0-7). Fuera de rango se pliega al ultimo slot ("Otros"). */
export function seriesVar(slot: number): string {
  const i = Math.max(0, Math.min(MAX_SLOTS - 1, slot))
  return `var(--series-${i + 1})`
}

export const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
} as const

/** Color de estado segun el consumo del limite. */
export function limitStatus(ratio: number): keyof typeof STATUS {
  if (ratio >= 1) return 'critical'
  if (ratio >= 0.9) return 'serious'
  if (ratio >= 0.75) return 'warning'
  return 'good'
}
