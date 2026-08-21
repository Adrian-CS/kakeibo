import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONFIG_KEY,
  SESSION_KEY,
  SupabaseError,
  decodeJwt,
  ensureFresh,
  loadConfig,
  loadSession,
  parseAuthHash,
  pullDoc,
  pullDocFor,
  pushDoc,
  saveConfig,
  saveSession,
  sendLoginEmail,
  sessionFromTokens,
  verifyEmailCode,
} from './supabase'
import { emptyData } from './defaults'
import type { Session } from './supabase'

const CFG = { url: 'https://proyecto.supabase.co', anonKey: 'anon-123' }

/** JWT de juguete: cabecera.carga.firma, sin firmar de verdad. */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.firma`
}

const TOKEN = jwt({ sub: 'user-1', email: 'yo@ejemplo.com' })

function okJson(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    accessToken: TOKEN,
    refreshToken: 'refresh-1',
    expiresAt: Date.now() + 3_600_000,
    userId: 'user-1',
    email: 'yo@ejemplo.com',
    ...overrides,
  }
}

beforeEach(() => localStorage.clear())

describe('configuracion y sesion', () => {
  it('guarda y recupera la configuracion, quitando la barra final', () => {
    saveConfig({ url: 'https://x.supabase.co/', anonKey: 'k' })
    expect(loadConfig()).toEqual({ url: 'https://x.supabase.co', anonKey: 'k' })
  })

  it('sin configuracion devuelve null', () => {
    expect(loadConfig()).toBeNull()
  })

  it('una configuracion corrupta no rompe nada', () => {
    localStorage.setItem(CONFIG_KEY, 'no es json')
    expect(loadConfig()).toBeNull()
  })

  it('guarda y borra la sesion', () => {
    const s = session()
    saveSession(s)
    expect(loadSession()?.userId).toBe('user-1')
    saveSession(null)
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('descarta una sesion incompleta', () => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ accessToken: 'a' }))
    expect(loadSession()).toBeNull()
  })
})

describe('piezas puras', () => {
  it('descodifica el JWT', () => {
    expect(decodeJwt(TOKEN)).toMatchObject({ sub: 'user-1', email: 'yo@ejemplo.com' })
    expect(decodeJwt('basura')).toBeNull()
    expect(decodeJwt('')).toBeNull()
  })

  it('lee el hash del enlace del correo', () => {
    const h = '#access_token=abc&refresh_token=def&expires_in=3600&token_type=bearer'
    expect(parseAuthHash(h)).toEqual({ accessToken: 'abc', refreshToken: 'def', expiresIn: 3600 })
  })

  it('ignora un hash normal de la aplicacion', () => {
    expect(parseAuthHash('#/month/2026-08')).toBeNull()
    expect(parseAuthHash('')).toBeNull()
  })

  it('recoge el error que devuelve el enlace caducado', () => {
    const r = parseAuthHash('#error=access_denied&error_description=Email%20link%20is%20invalid')
    expect(r?.error).toContain('invalid')
  })

  it('avisa si faltan tokens', () => {
    expect(parseAuthHash('#access_token=abc')?.error).toBeTruthy()
  })

  it('construye la sesion desde los tokens', () => {
    const s = sessionFromTokens({ access_token: TOKEN, refresh_token: 'r', expires_in: 60 })
    expect(s.userId).toBe('user-1')
    expect(s.email).toBe('yo@ejemplo.com')
    expect(s.expiresAt).toBeGreaterThan(Date.now())
  })
})

describe('llamadas', () => {
  it('pide el correo de acceso con el redirect', async () => {
    const f = vi.fn().mockResolvedValue(okJson({}))
    await sendLoginEmail(CFG, 'yo@ejemplo.com', 'https://usuario.github.io/kakeibo/', f)
    const [url, init] = f.mock.calls[0]
    expect(url).toContain('/auth/v1/otp?redirect_to=https%3A%2F%2Fusuario.github.io%2Fkakeibo%2F')
    expect(JSON.parse(init.body)).toMatchObject({ email: 'yo@ejemplo.com', create_user: true })
    expect(init.headers.apikey).toBe('anon-123')
  })

  it('sin direccion de vuelta no manda redirect_to', async () => {
    // asi Supabase usa el Site URL del proyecto a proposito, en vez de
    // rechazar una direccion invalida y caer en el por sorpresa
    const f = vi.fn().mockResolvedValue(okJson({}))
    await sendLoginEmail(CFG, 'yo@ejemplo.com', null, f)
    expect(f.mock.calls[0][0]).toBe('https://proyecto.supabase.co/auth/v1/otp')
  })

  it('canjea el codigo de seis digitos', async () => {
    const f = vi
      .fn()
      .mockResolvedValue(okJson({ access_token: TOKEN, refresh_token: 'r', expires_in: 3600 }))
    const s = await verifyEmailCode(CFG, 'yo@ejemplo.com', ' 123456 ', f)
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({
      type: 'email',
      email: 'yo@ejemplo.com',
      token: '123456',
    })
    expect(s.userId).toBe('user-1')
  })

  it('propaga el mensaje de error del servidor', async () => {
    const f = vi.fn().mockResolvedValue(okJson({ msg: 'Token has expired' }, 401))
    await expect(verifyEmailCode(CFG, 'a@b.c', '000000', f)).rejects.toThrow(/expired/)
    await expect(verifyEmailCode(CFG, 'a@b.c', '000000', f)).rejects.toBeInstanceOf(SupabaseError)
  })

  it('no refresca una sesion que aun vale', async () => {
    const f = vi.fn()
    const s = session()
    expect(await ensureFresh(CFG, s, f)).toBe(s)
    expect(f).not.toHaveBeenCalled()
  })

  it('refresca la sesion caducada y la guarda', async () => {
    const f = vi
      .fn()
      .mockResolvedValue(okJson({ access_token: TOKEN, refresh_token: 'r2', expires_in: 3600 }))
    const fresh = await ensureFresh(CFG, session({ expiresAt: Date.now() - 1000 }), f)
    expect(f.mock.calls[0][0]).toContain('grant_type=refresh_token')
    expect(fresh.refreshToken).toBe('r2')
    expect(loadSession()?.refreshToken).toBe('r2')
  })

  it('lee el documento remoto', async () => {
    const data = emptyData()
    const f = vi.fn().mockResolvedValue(okJson([{ data, updated_at: '2026-08-20T00:00:00Z' }]))
    const doc = await pullDoc(CFG, session(), f)
    expect(f.mock.calls[0][0]).toContain('/rest/v1/kakeibo_docs?select=data,updated_at&user_id=eq.user-1')
    expect(f.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(doc?.updatedAt).toBe('2026-08-20T00:00:00Z')
  })

  it('si no hay fila devuelve null', async () => {
    const f = vi.fn().mockResolvedValue(okJson([]))
    expect(await pullDoc(CFG, session(), f)).toBeNull()
  })

  it('pullDocFor lee el documento de otro usuario (para la pareja vinculada)', async () => {
    const data = emptyData()
    const f = vi.fn().mockResolvedValue(okJson([{ data, updated_at: '2026-08-20T00:00:00Z' }]))
    const doc = await pullDocFor(CFG, session(), 'user-2', f)
    expect(f.mock.calls[0][0]).toContain('user_id=eq.user-2')
    expect(doc?.updatedAt).toBe('2026-08-20T00:00:00Z')
  })

  it('sube el documento sin el estado de sincronizacion', async () => {
    const f = vi.fn().mockResolvedValue(okJson([{ updated_at: '2026-08-20T10:00:00Z' }]))
    const data = { ...emptyData(), updatedAt: '2026-08-20T09:00:00Z', sync: { lastSyncAt: 'x' } }
    const at = await pushDoc(CFG, session(), data, f)
    const body = JSON.parse(f.mock.calls[0][1].body)
    expect(body[0].user_id).toBe('user-1')
    expect(body[0].updated_at).toBe('2026-08-20T09:00:00Z')
    expect(body[0].data.sync).toBeUndefined()
    expect(f.mock.calls[0][1].headers.Prefer).toContain('merge-duplicates')
    expect(at).toBe('2026-08-20T10:00:00Z')
  })
})
