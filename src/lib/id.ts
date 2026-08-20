let counter = 0

/** Identificador corto, unico dentro de la sesion y estable al guardar. */
export function uid(prefix = 'i'): string {
  counter += 1
  const rnd = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rnd}`
}
