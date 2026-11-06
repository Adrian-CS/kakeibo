import { describe, expect, it } from 'vitest'
import { DICTS, LANGS } from './i18n'

/**
 * El diccionario `es` es el de referencia: su tipo obliga a que exista cada
 * clave que se usa en las vistas. Los otros dos son `Partial`, asi que una
 * clave que falte ahi no rompe nada al compilar y se ve en marcha, en japones
 * o en ingles, con una frase en castellano en medio.
 */
describe('diccionarios', () => {
  const es = Object.keys(DICTS.es)

  it('todos tienen las mismas claves que el castellano', () => {
    for (const lang of LANGS.map((l) => l.id)) {
      const keys = Object.keys(DICTS[lang])
      expect({ lang, missing: es.filter((k) => !keys.includes(k)) }).toEqual({ lang, missing: [] })
      expect({ lang, extra: keys.filter((k) => !es.includes(k)) }).toEqual({ lang, extra: [] })
    }
  })

  it('ninguna traduccion se deja un hueco a rellenar', () => {
    // {algo} que este en el original tiene que estar tambien en la traduccion:
    // si no, sale el texto con el hueco sin rellenar o le falta el dato
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const lang of LANGS.map((l) => l.id)) {
      for (const key of es) {
        const original = DICTS.es[key as keyof typeof DICTS.es]
        const translated = DICTS[lang][key as keyof typeof DICTS.es]
        if (!original || !translated) continue
        expect({ lang, key, holes: holes(translated) }).toEqual({
          lang,
          key,
          holes: holes(original),
        })
      }
    }
  })

  it('no hay claves sin traducir de verdad', () => {
    for (const lang of LANGS.map((l) => l.id).filter((l) => l !== 'es')) {
      const same = es.filter((k) => {
        const a = DICTS.es[k as keyof typeof DICTS.es]
        const b = DICTS[lang][k as keyof typeof DICTS.es]
        // palabras que se escriben igual en los dos idiomas no cuentan
        return a !== undefined && a === b && a.length > 24
      })
      expect({ lang, same }).toEqual({ lang, same: [] })
    }
  })
})
