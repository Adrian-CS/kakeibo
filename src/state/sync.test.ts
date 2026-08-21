import { describe, expect, it } from 'vitest'
import { redirectTarget } from './sync'

describe('redirectTarget', () => {
  it('devuelve el origen mas la ruta base cuando la app se sirve por web', () => {
    expect(redirectTarget({ protocol: 'https:', origin: 'https://usuario.github.io' })).toMatch(
      /^https:\/\/usuario\.github\.io\//,
    )
    expect(redirectTarget({ protocol: 'http:', origin: 'http://localhost:5173' })).toMatch(
      /^http:\/\/localhost:5173\//,
    )
  })

  it('devuelve null si la app se abre desde un fichero local', () => {
    expect(redirectTarget({ protocol: 'file:', origin: 'null' })).toBeNull()
  })
})
