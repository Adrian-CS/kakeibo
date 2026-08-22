/**
 * Motor de sincronizacion con Supabase.
 *
 * Regla de oro: el dispositivo manda. Todo se guarda primero en local (la app
 * funciona sin cobertura) y la nube es una copia que se fusiona cuando hay
 * red. Si no hay configuracion, todo esto se queda dormido y la aplicacion se
 * comporta exactamente como antes.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useStore } from './store'
import {
  ensureFresh,
  loadConfig,
  loadSession,
  pullDoc,
  pushDoc,
  saveConfig,
  saveSession,
  setUserPassword,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  type Session,
  type SupabaseConfig,
} from '../lib/supabase'
import { isAccountMismatch, mergeData, needsPush, nowIso, shouldAdoptRemote, signature } from '../lib/sync'
import { monthIdOf } from '../lib/defaults'
import { migrate } from '../lib/storage'
import type { AppData } from '../lib/types'

export type SyncStatus = 'unconfigured' | 'signedOut' | 'idle' | 'working' | 'error'

export interface SyncApi {
  status: SyncStatus
  /** direccion a la que volvera el enlace del correo de confirmacion (null si es imposible) */
  redirectTo: string | null
  /** mensaje corto para la interfaz (ya traducido por quien lo pone) */
  message: string
  config: SupabaseConfig | null
  session: Session | null
  lastSyncAt?: string
  setConfig: (c: SupabaseConfig | null) => void
  signUp: (email: string, password: string) => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  setPassword: (password: string) => Promise<void>
  syncNow: () => Promise<void>
  logOut: () => Promise<void>
}

const SyncContext = createContext<SyncApi | null>(null)

/**
 * URL a la que debe volver el enlace del correo de confirmacion, o null si la
 * app no esta servida por web (fichero local, `file://`): en ese caso no hay
 * vuelta posible y Supabase cae en el Site URL del proyecto.
 */
export function redirectTarget(loc: { protocol: string; origin: string } = window.location): string | null {
  if (loc.protocol !== 'http:' && loc.protocol !== 'https:') return null
  const base = import.meta.env?.BASE_URL ?? '/'
  return `${loc.origin}${base}`
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const { data, dispatch, t } = useStore()
  const [config, setConfigState] = useState<SupabaseConfig | null>(() => loadConfig())
  const [session, setSession] = useState<Session | null>(() => loadSession())
  const [status, setStatus] = useState<SyncStatus>('unconfigured')
  const [message, setMessage] = useState('')

  // el motor lee los datos con un ref para no reengancharse en cada tecla
  const dataRef = useRef<AppData>(data)
  dataRef.current = data
  const busy = useRef(false)
  const lastPushedSig = useRef<string>('')

  useEffect(() => {
    setStatus(!config ? 'unconfigured' : session ? 'idle' : 'signedOut')
  }, [config, session])

  const setConfig = useCallback((c: SupabaseConfig | null) => {
    saveConfig(c)
    setConfigState(c)
    if (!c) {
      saveSession(null)
      setSession(null)
    }
    setMessage('')
  }, [])

  /** Baja, fusiona y sube. Silencioso salvo error. */
  const syncNow = useCallback(async () => {
    if (!config || !session || busy.current) return
    busy.current = true
    setStatus('working')
    setMessage('')
    try {
      const local = dataRef.current
      // este dispositivo ya se sincronizo antes con otra cuenta: fusionar sin
      // avisar mezclaria (o subiria de golpe) esos datos a la cuenta nueva
      if (isAccountMismatch(local, session.email)) {
        setStatus('error')
        setMessage(t('sync.accountMismatch', { email: local.sync?.lastSyncedEmail ?? '?' }))
        return
      }

      const fresh = await ensureFresh(config, session)
      if (fresh !== session) setSession(fresh)

      const pulled = await pullDoc(config, fresh)
      // la nube puede traer un documento mas viejo que este mismo build (le
      // falten campos que no existian cuando se subio): lo pasamos por el
      // mismo saneado que una copia importada a mano, para no arrastrar
      // `undefined` a sitios que ya no lo esperan
      const remote = pulled ? { ...pulled, data: migrate(pulled.data) } : null
      let merged = local

      if (remote && shouldAdoptRemote(local)) {
        // primer acceso en este dispositivo: se adopta la copia de la nube
        merged = { ...remote.data, sync: local.sync }
        dispatch({ type: 'applyMerge', data: merged })
        dispatch({ type: 'ensureMonth', monthId: monthIdOf() })
      } else if (remote) {
        merged = mergeData(local, remote.data)
        // solo aplicamos si el contenido cambia de verdad: comparar solo
        // altas/bajas de gastos dejaba fuera cualquier edicion pura (importe,
        // alquiler, ajustes, categorias...) que llegara de otro dispositivo
        if (signature(merged) !== signature(local)) {
          dispatch({ type: 'applyMerge', data: { ...merged, sync: local.sync } })
        }
      }

      // el email de la sesion sobrevive a un "Salir" en `lastSyncedEmail` (a
      // diferencia de `email`), para poder detectar un cambio de cuenta la
      // proxima vez; solo se pisa si de verdad hay uno nuevo que anotar
      const emailPatch = fresh.email ? { lastSyncedEmail: fresh.email } : {}
      if (needsPush(merged, remote?.data ?? null)) {
        const at = await pushDoc(config, fresh, { ...merged, updatedAt: merged.updatedAt ?? nowIso() })
        lastPushedSig.current = signature(merged)
        dispatch({ type: 'patchSync', patch: { lastSyncAt: nowIso(), lastRemoteAt: at, ...emailPatch } })
      } else {
        lastPushedSig.current = signature(merged)
        dispatch({
          type: 'patchSync',
          patch: { lastSyncAt: nowIso(), lastRemoteAt: remote?.updatedAt, ...emailPatch },
        })
      }
      setStatus('idle')
    } catch (e) {
      setStatus('error')
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      busy.current = false
    }
  }, [config, session, dispatch, t])

  const signUp = useCallback(
    async (email: string, password: string) => {
      if (!config) return
      setStatus('working')
      setMessage('')
      try {
        const s = await signUpWithPassword(config, email.trim(), password, redirectTarget())
        if (s) {
          saveSession(s)
          setSession(s)
          dispatch({ type: 'patchSync', patch: { email: s.email } })
          setStatus('idle')
        } else {
          // el proyecto exige confirmar el correo antes de dejar entrar
          setStatus('signedOut')
          setMessage(t('sync.confirmEmailSent'))
        }
      } catch (e) {
        setStatus('error')
        setMessage(e instanceof Error ? e.message : String(e))
      }
    },
    [config, dispatch, t],
  )

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!config) return
      setStatus('working')
      setMessage('')
      try {
        const s = await signInWithPassword(config, email.trim(), password)
        saveSession(s)
        setSession(s)
        dispatch({ type: 'patchSync', patch: { email: s.email } })
        setStatus('idle')
      } catch (e) {
        setStatus('error')
        setMessage(e instanceof Error ? e.message : String(e))
      }
    },
    [config, dispatch],
  )

  const setPassword = useCallback(
    async (password: string) => {
      if (!config || !session) return
      setStatus('working')
      setMessage('')
      try {
        const fresh = await ensureFresh(config, session)
        if (fresh !== session) setSession(fresh)
        await setUserPassword(config, fresh, password)
        setStatus('idle')
        setMessage(t('sync.passwordSet'))
      } catch (e) {
        setStatus('error')
        setMessage(e instanceof Error ? e.message : String(e))
      }
    },
    [config, session, t],
  )

  const logOut = useCallback(async () => {
    if (config && session) await signOut(config, session)
    saveSession(null)
    setSession(null)
    dispatch({ type: 'patchSync', patch: { email: undefined } })
  }, [config, session, dispatch])

  // al abrir la app y al volver a ella
  useEffect(() => {
    if (!config || !session) return
    void syncNow()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncNow()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
    }
    // syncNow cambia con la sesion, no con los datos
  }, [config, session, syncNow])

  // tras cambiar algo, subir pasados unos segundos de calma
  useEffect(() => {
    if (!config || !session) return
    if (signature(data) === lastPushedSig.current) return
    const id = setTimeout(() => void syncNow(), 4000)
    return () => clearTimeout(id)
  }, [data, config, session, syncNow])

  const api = useMemo<SyncApi>(
    () => ({
      status,
      redirectTo: redirectTarget(),
      message,
      config,
      session,
      lastSyncAt: data.sync?.lastSyncAt,
      setConfig,
      signUp,
      signIn,
      setPassword,
      syncNow,
      logOut,
    }),
    [
      status,
      message,
      config,
      session,
      data.sync?.lastSyncAt,
      setConfig,
      signUp,
      signIn,
      setPassword,
      syncNow,
      logOut,
    ],
  )

  return <SyncContext.Provider value={api}>{children}</SyncContext.Provider>
}

export function useSync(): SyncApi {
  const ctx = useContext(SyncContext)
  if (!ctx) throw new Error('useSync debe usarse dentro de <SyncProvider>')
  return ctx
}
