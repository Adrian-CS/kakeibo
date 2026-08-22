/**
 * Cliente minimo de Supabase, escrito con `fetch`.
 *
 * La libreria oficial pesa mas de 100 kB y aqui solo hacen falta unas pocas
 * llamadas: crear cuenta o entrar con correo y contraseña, refrescar la
 * sesion y leer/escribir un documento. Menos peso en el movil y ninguna
 * dependencia que actualizar.
 *
 * La tabla esperada (ver supabase/schema.sql):
 *   kakeibo_docs(user_id uuid primary key, data jsonb, updated_at timestamptz)
 * con RLS: cada usuario solo ve su fila.
 */
import type { AppData } from './types'

export const TABLE = 'kakeibo_docs'
export const CONFIG_KEY = 'kakeibo:supabase:v1'
export const SESSION_KEY = 'kakeibo:auth:v1'

export interface SupabaseConfig {
  url: string
  anonKey: string
}

export interface Session {
  accessToken: string
  refreshToken: string
  /** epoch en milisegundos */
  expiresAt: number
  userId: string
  email?: string
}

export type Fetcher = typeof fetch

/* ------------------------------------------------------------------ *
 * Configuracion y sesion (localStorage, con las variables de entorno
 * como valor por defecto)
 * ------------------------------------------------------------------ */

function ls(): Storage | null {
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

export function envConfig(): SupabaseConfig | null {
  const url = import.meta.env?.VITE_SUPABASE_URL as string | undefined
  const anonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY as string | undefined
  return url && anonKey ? { url: url.replace(/\/$/, ''), anonKey } : null
}

export function loadConfig(): SupabaseConfig | null {
  const raw = ls()?.getItem(CONFIG_KEY)
  if (raw) {
    try {
      const c = JSON.parse(raw) as SupabaseConfig
      if (c?.url && c?.anonKey) return { url: c.url.replace(/\/$/, ''), anonKey: c.anonKey }
    } catch {
      /* configuracion corrupta: se ignora */
    }
  }
  return envConfig()
}

export function saveConfig(c: SupabaseConfig | null): void {
  if (!c) ls()?.removeItem(CONFIG_KEY)
  else ls()?.setItem(CONFIG_KEY, JSON.stringify({ ...c, url: c.url.replace(/\/$/, '') }))
}

export function loadSession(): Session | null {
  const raw = ls()?.getItem(SESSION_KEY)
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as Session
    return s?.accessToken && s?.refreshToken && s?.userId ? s : null
  } catch {
    return null
  }
}

export function saveSession(s: Session | null): void {
  if (!s) ls()?.removeItem(SESSION_KEY)
  else ls()?.setItem(SESSION_KEY, JSON.stringify(s))
}

/* ------------------------------------------------------------------ *
 * Piezas puras
 * ------------------------------------------------------------------ */

/** Descodifica la carga de un JWT sin verificarlo (solo para leer sub/email). */
export function decodeJwt(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : ''
    const json = decodeURIComponent(
      atob(b64 + pad)
        .split('')
        .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join(''),
    )
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  user?: { id?: string; email?: string }
}

export function sessionFromTokens(t: {
  access_token: string
  refresh_token: string
  expires_in?: number
  user?: { id?: string; email?: string }
}): Session {
  const payload = decodeJwt(t.access_token) ?? {}
  const userId = t.user?.id ?? (payload.sub as string | undefined) ?? ''
  const email = t.user?.email ?? (payload.email as string | undefined)
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000,
    userId,
    email,
  }
}

/* ------------------------------------------------------------------ *
 * Llamadas
 * ------------------------------------------------------------------ */

export class SupabaseError extends Error {}

async function readError(res: Response): Promise<string> {
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    /* la respuesta no era JSON */
  }
  const b = (body ?? {}) as Record<string, string>
  return b.error_description || b.msg || b.message || b.error || `HTTP ${res.status}`
}

/** Expuesta para otros clientes minimos sobre la misma API (ver household.ts). */
export async function call<T>(
  cfg: SupabaseConfig,
  path: string,
  init: RequestInit,
  f: Fetcher = fetch,
): Promise<T> {
  const res = await f(`${cfg.url}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      apikey: cfg.anonKey,
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) throw new SupabaseError(await readError(res))
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

/**
 * Crea la cuenta con correo y contraseña. Si el proyecto exige confirmar el
 * correo antes de dejar entrar, la respuesta no trae sesion todavia (solo el
 * usuario recien creado): hay que avisar de que revise el correo y luego
 * entre con `signInWithPassword`.
 *
 * `redirectTo` es a donde vuelve el enlace de ESE correo de confirmacion
 * (Supabase sigue mandando uno aunque el acceso normal ya no use enlaces).
 * Puede ser null: si la app se abre desde un fichero local no hay direccion a
 * la que volver, y mandar una invalida hace que Supabase caiga en el "Site
 * URL" del proyecto (que por defecto es localhost). Mejor no mandar nada y
 * que use el Site URL a proposito.
 */
export async function signUpWithPassword(
  cfg: SupabaseConfig,
  email: string,
  password: string,
  redirectTo: string | null,
  f: Fetcher = fetch,
): Promise<Session | null> {
  const query = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : ''
  const t = await call<Partial<TokenResponse>>(
    cfg,
    `/auth/v1/signup${query}`,
    { method: 'POST', body: JSON.stringify({ email, password }) },
    f,
  )
  if (!t.access_token || !t.refresh_token) return null
  return sessionFromTokens({ ...t, access_token: t.access_token, refresh_token: t.refresh_token })
}

/** Entra con correo y contraseña ya creados. */
export async function signInWithPassword(
  cfg: SupabaseConfig,
  email: string,
  password: string,
  f: Fetcher = fetch,
): Promise<Session> {
  const t = await call<TokenResponse>(
    cfg,
    '/auth/v1/token?grant_type=password',
    { method: 'POST', body: JSON.stringify({ email, password }) },
    f,
  )
  return sessionFromTokens(t)
}

/**
 * Pone (o cambia) la contraseña de la cuenta ya autenticada. Hace falta para
 * las cuentas que se crearon antes con el enlace del correo, que nunca
 * llegaron a tener una: con la sesion todavia abierta, esto les da la
 * contraseña que les falta sin tener que borrar la cuenta ni perder datos.
 */
export async function setUserPassword(
  cfg: SupabaseConfig,
  session: Session,
  password: string,
  f: Fetcher = fetch,
): Promise<void> {
  await call<unknown>(
    cfg,
    '/auth/v1/user',
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify({ password }),
    },
    f,
  )
}

export async function refreshSession(
  cfg: SupabaseConfig,
  session: Session,
  f: Fetcher = fetch,
): Promise<Session> {
  const t = await call<TokenResponse>(
    cfg,
    '/auth/v1/token?grant_type=refresh_token',
    { method: 'POST', body: JSON.stringify({ refresh_token: session.refreshToken }) },
    f,
  )
  return sessionFromTokens(t)
}

/** Devuelve una sesion valida, refrescandola si le queda poco. */
export async function ensureFresh(
  cfg: SupabaseConfig,
  session: Session,
  f: Fetcher = fetch,
): Promise<Session> {
  if (session.expiresAt - Date.now() > 60_000) return session
  const fresh = await refreshSession(cfg, session, f)
  saveSession(fresh)
  return fresh
}

export async function signOut(
  cfg: SupabaseConfig,
  session: Session,
  f: Fetcher = fetch,
): Promise<void> {
  try {
    await call<unknown>(
      cfg,
      '/auth/v1/logout',
      { method: 'POST', headers: { Authorization: `Bearer ${session.accessToken}` } },
      f,
    )
  } catch {
    // si el servidor no contesta, la sesion local se borra igualmente
  }
  saveSession(null)
}

export interface RemoteDoc {
  data: AppData
  updatedAt: string
}

/**
 * Lee el documento de un usuario cualquiera (por defecto, el propio). Sirve
 * tanto para `pullDoc` como para leer el de la pareja vinculada: la RLS de
 * `kakeibo_docs` es quien decide si la fila pedida es visible o no, esta
 * funcion no distingue "mio" de "de la pareja".
 */
export async function pullDocFor(
  cfg: SupabaseConfig,
  session: Session,
  userId: string,
  f: Fetcher = fetch,
): Promise<RemoteDoc | null> {
  const rows = await call<{ data: AppData; updated_at: string }[]>(
    cfg,
    `/rest/v1/${TABLE}?select=data,updated_at&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    { method: 'GET', headers: { Authorization: `Bearer ${session.accessToken}` } },
    f,
  )
  const row = rows?.[0]
  if (!row?.data) return null
  return { data: row.data, updatedAt: row.updated_at }
}

export async function pullDoc(
  cfg: SupabaseConfig,
  session: Session,
  f: Fetcher = fetch,
): Promise<RemoteDoc | null> {
  return pullDocFor(cfg, session, session.userId, f)
}

export async function pushDoc(
  cfg: SupabaseConfig,
  session: Session,
  data: AppData,
  f: Fetcher = fetch,
): Promise<string> {
  const updatedAt = data.updatedAt ?? new Date().toISOString()
  const rows = await call<{ updated_at: string }[]>(
    cfg,
    `/rest/v1/${TABLE}?select=updated_at`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify([
        {
          user_id: session.userId,
          // el estado de sincronizacion es de cada dispositivo: no se sube
          data: { ...data, sync: undefined },
          updated_at: updatedAt,
        },
      ]),
    },
    f,
  )
  return rows?.[0]?.updated_at ?? updatedAt
}
