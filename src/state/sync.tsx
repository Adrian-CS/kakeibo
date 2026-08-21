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
  signOut,
  type Session,
  type SupabaseConfig,
} from '../lib/supabase'
import { mergeData, mergeReport, needsPush, nowIso, signature } from '../lib/sync'
import type { AppData } from '../lib/types'

export type SyncStatus = 'unconfigured' | 'signedOut' | 'idle' | 'working' | 'error'

export interface SyncApi {
  status: SyncStatus
  /** direccion a la que volvera el enlace del correo (null si es imposible) */
  redirectTo: string | null
  /** mensaje corto para la interfaz (ya traducido por quien lo pone) */
  message: string
  config: SupabaseConfig | null
  session: Session | null
  lastSyncAt?: string
  pendingCode: boolean
  setConfig: (c: SupabaseConfig | null) => void
  requestCode: (email: string) => Promise<void>
  submitCode: (email: string, code: string) => Promise<void>
  syncNow: () => Promise<void>
  logOut: () => Promise<void>
}

const SyncContext = createContext<SyncApi | null>(null)

/**
 * URL a la que debe volver el enlace del correo, o null si la app no esta
 * servida por web (fichero local, `file://`): en ese caso no hay vuelta
 * posible y hay que entrar con el codigo.
 */
export function redirectTarget(loc: { protocol: string; origin: string } = window.location): string | null {
  if (loc.protocol !== 'http:' && loc.protocol !== 'https:') return null
  const base = import.meta.env?.BASE_URL ?? '/'
  return `${loc.origin}${base}`
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const { data, dispatch } = useStore()
  const [config, setConfigState] = useState<SupabaseConfig | null>(() => loadConfig())
  const [session, setSession] = useState<Session | null>(() => loadSession())
  const [status, setStatus] = useState<SyncStatus>('unconfigured')
  const [message, setMessage] = useState('')
  const [pendingCode, setPendingCode] = useState(false)

  // el motor lee los datos con un ref para no reengancharse en cada tecla
  const dataRef = useRef<AppData>(data)
  dataRef.current = data
  const busy = useRef(false)
  const lastPushedSig = useRef<string>('')

  useEffect(() => {
    setStatus(!config ? 'unconfigured' : session ? 'idle' : 'signedOut')
  }, [config, session])

  // error que dejo el enlace del correo (lo recoge main.tsx antes de montar)
  useEffect(() => {
    try {
      const err = sessionStorage.getItem('kakeibo:authError')
      if (err) {
        sessionStorage.removeItem('kakeibo:authError')
        setStatus('error')
        setMessage(err)
      }
    } catch {
      /* sin sessionStorage no hay nada que recoger */
    }
  }, [])

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
      const fresh = await ensureFresh(config, session)
      if (fresh !== session) setSession(fresh)

      const remote = await pullDoc(config, fresh)
      const local = dataRef.current
      let merged = local

      if (remote) {
        merged = mergeData(local, remote.data)
        const report = mergeReport(local, merged)
        if (report.addedExpenses || report.removedExpenses || report.addedMonths) {
          dispatch({ type: 'applyMerge', data: { ...merged, sync: local.sync } })
        }
      }

      if (needsPush(merged, remote?.data ?? null)) {
        const at = await pushDoc(config, fresh, { ...merged, updatedAt: merged.updatedAt ?? nowIso() })
        lastPushedSig.current = signature(merged)
        dispatch({ type: 'patchSync', patch: { lastSyncAt: nowIso(), lastRemoteAt: at } })
      } else {
        lastPushedSig.current = signature(merged)
        dispatch({
          type: 'patchSync',
          patch: { lastSyncAt: nowIso(), lastRemoteAt: remote?.updatedAt },
        })
      }
      setStatus('idle')
    } catch (e) {
      setStatus('error')
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      busy.current = false
    }
  }, [config, session, dispatch])

  const requestCode = useCallback(
    async (email: string) => {
      if (!config) return
      setStatus('working')
      setMessage('')
      try {
        const { sendLoginEmail } = await import('../lib/supabase')
        await sendLoginEmail(config, email.trim(), redirectTarget())
        setPendingCode(true)
        setStatus('signedOut')
      } catch (e) {
        setStatus('error')
        setMessage(e instanceof Error ? e.message : String(e))
      }
    },
    [config],
  )

  const submitCode = useCallback(
    async (email: string, code: string) => {
      if (!config) return
      setStatus('working')
      setMessage('')
      try {
        const { verifyEmailCode } = await import('../lib/supabase')
        const s = await verifyEmailCode(config, email.trim(), code)
        saveSession(s)
        setSession(s)
        setPendingCode(false)
        dispatch({ type: 'patchSync', patch: { email: s.email } })
        setStatus('idle')
      } catch (e) {
        setStatus('error')
        setMessage(e instanceof Error ? e.message : String(e))
      }
    },
    [config, dispatch],
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
      message,
      redirectTo: redirectTarget(),
      config,
      session,
      lastSyncAt: data.sync?.lastSyncAt,
      pendingCode,
      setConfig,
      requestCode,
      submitCode,
      syncNow,
      logOut,
    }),
    [status, message, config, session, data.sync?.lastSyncAt, pendingCode, setConfig, requestCode, submitCode, syncNow, logOut],
  )

  return <SyncContext.Provider value={api}>{children}</SyncContext.Provider>
}

export function useSync(): SyncApi {
  const ctx = useContext(SyncContext)
  if (!ctx) throw new Error('useSync debe usarse dentro de <SyncProvider>')
  return ctx
}
