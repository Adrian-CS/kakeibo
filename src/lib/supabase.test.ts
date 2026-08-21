import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONFIG_KEY,
  SESSION_KEY,
  SupabaseError,
  decodeJwt,
  ensureFresh,
  loadConfig,
  loadSession,
  pullDoc,
  pullDocFor,
  pushDoc,
  saveConfig,
  saveSession,
  sessionFromTokens,
  signInWithPassword,
  signUpWithPassword,
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

  it('construye la sesion desde los tokens', () => {
    const s = sessionFromTokens({ access_token: TOKEN, refresh_token: 'r', expires_in: 60 })
    expect(s.userId).toBe('user-1')
    expect(s.email).toBe('yo@ejemplo.com')
    expect(s.expiresAt).toBeGreaterThan(Date.now())
  })
})

describe('llamadas', () => {
  it('crea la cuenta con correo y contraseña', async () => {
    const f = vi
      .fn()
      .mockResolvedValue(okJson({ access_token: TOKEN, refresh_token: 'r', expires_in: 3600 }))
    const s = await signUpWithPassword(CFG, 'yo@ejemplo.com', 'clave-segura', f)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://proyecto.supabase.co/auth/v1/signup')
    expect(JSON.parse(init.body)).toEqual({ email: 'yo@ejemplo.com', password: 'clave-segura' })
    expect(init.headers.apikey).toBe('anon-123')
    expect(s?.userId).toBe('user-1')
  })

  it('si el proyecto exige confirmar el correo, signUp no trae sesion', async () => {
    const f = vi.fn().mockResolvedValue(okJson({ id: 'user-1', email: 'yo@ejemplo.com' }))
    expect(await signUpWithPassword(CFG, 'yo@ejemplo.com', 'clave-segura', f)).toBeNull()
  })

  it('entra con correo y contraseña', async () => {
    const f = vi
      .fn()
      .mockResolvedValue(okJson({ access_token: TOKEN, refresh_token: 'r', expires_in: 3600 }))
    const s = await signInWithPassword(CFG, 'yo@ejemplo.com', 'clave-segura', f)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://proyecto.supabase.co/auth/v1/token?grant_type=password')
    expect(JSON.parse(init.body)).toEqual({ email: 'yo@ejemplo.com', password: 'clave-segura' })
    expect(s.userId).toBe('user-1')
  })

  it('propaga el mensaje de error del servidor', async () => {
    const f = vi.fn().mockResolvedValue(okJson({ msg: 'Invalid login credentials' }, 400))
    await expect(signInWithPassword(CFG, 'a@b.c', 'mala', f)).rejects.toThrow(/Invalid login/)
    await expect(signInWithPassword(CFG, 'a@b.c', 'mala', f)).rejects.toBeInstanceOf(SupabaseError)
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
