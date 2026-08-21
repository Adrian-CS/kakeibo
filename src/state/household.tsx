/**
 * Vinculo de pareja: solo lectura de los datos de la pareja, una vez
 * aceptada la invitacion (ver `lib/household.ts` y
 * `supabase/household_schema.sql`).
 *
 * Regla de oro, igual que en `sync.tsx`: esto nunca toca el `AppData` propio.
 * `partnerData` vive en un estado de React aparte, no se guarda en
 * localStorage ni se pasa nunca a `dispatch`/`pushDoc`/`mergeData` del
 * documento propio -- asi es fisicamente imposible que un guardado
 * accidental lo suba o lo mezcle con lo mio.
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
import { useSync } from './sync'
import {
  acceptHouseholdInvite,
  activeLink,
  declineHouseholdInvite,
  inviteHousehold,
  listHouseholdLinks,
  partnerIdOf,
  receivedPending,
  revokeHouseholdInvite,
  sentPending,
  unlinkHousehold,
  type HouseholdLink,
} from '../lib/household'
import { ensureFresh, pullDocFor } from '../lib/supabase'
import { migrate } from '../lib/storage'
import type { AppData } from '../lib/types'

export type HouseholdStatus = 'unavailable' | 'idle' | 'working' | 'error'
/** Que datos ensenar: los mios, los de mi pareja, o los dos juntos. */
export type HouseholdViewScope = 'mine' | 'partner' | 'together'

export interface HouseholdApi {
  status: HouseholdStatus
  message: string
  links: HouseholdLink[]
  sentPending: HouseholdLink[]
  receivedPending: HouseholdLink[]
  partnerLink: HouseholdLink | null
  partnerUserId: string | null
  /** solo lectura: el documento de la pareja, o null si no hay vinculo o aun no ha llegado */
  partnerData: AppData | null
  invite: (email: string) => Promise<void>
  accept: (id: string) => Promise<void>
  decline: (id: string) => Promise<void>
  revoke: (id: string) => Promise<void>
  unlink: (id: string) => Promise<void>
  refresh: () => Promise<void>
}

const HouseholdContext = createContext<HouseholdApi | null>(null)

// mas espaciado que la sync propia (sin debounce de 4s): es de solo lectura
const POLL_MS = 60_000

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const sync = useSync()
  const [links, setLinks] = useState<HouseholdLink[]>([])
  const [partnerData, setPartnerData] = useState<AppData | null>(null)
  const [status, setStatus] = useState<HouseholdStatus>('unavailable')
  const [message, setMessage] = useState('')
  const busy = useRef(false)

  const myUserId = sync.session?.userId
  const partnerLink = useMemo(() => (myUserId ? activeLink(links, myUserId) : null), [links, myUserId])
  const partnerUserId = useMemo(
    () => (partnerLink && myUserId ? partnerIdOf(partnerLink, myUserId) : null),
    [partnerLink, myUserId],
  )
  const sent = useMemo(() => (myUserId ? sentPending(links, myUserId) : []), [links, myUserId])
  const received = useMemo(() => (myUserId ? receivedPending(links, myUserId) : []), [links, myUserId])

  useEffect(() => {
    setStatus(sync.config && sync.session ? 'idle' : 'unavailable')
  }, [sync.config, sync.session])

  const refresh = useCallback(async () => {
    const { config, session } = sync
    if (!config || !session || busy.current) return
    busy.current = true
    setStatus('working')
    setMessage('')
    try {
      const fresh = await ensureFresh(config, session)
      const rows = await listHouseholdLinks(config, fresh)
      setLinks(rows)

      const link = activeLink(rows, fresh.userId)
      if (!link) {
        setPartnerData(null)
      } else {
        const partnerId = partnerIdOf(link, fresh.userId)
        const pulled = await pullDocFor(config, fresh, partnerId)
        // igual que con la copia propia: se sanea con el mismo migrate() por
        // si el documento de la pareja viene de una version mas vieja
        setPartnerData(pulled ? migrate(pulled.data) : null)
      }
      setStatus('idle')
    } catch (e) {
      setStatus('error')
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      busy.current = false
    }
  }, [sync])

  const invite = useCallback(
    async (email: string) => {
      if (!sync.config || !sync.session) return
      await inviteHousehold(sync.config, sync.session, email)
      await refresh()
    },
    [sync.config, sync.session, refresh],
  )

  const accept = useCallback(
    async (id: string) => {
      if (!sync.config || !sync.session) return
      await acceptHouseholdInvite(sync.config, sync.session, id)
      await refresh()
    },
    [sync.config, sync.session, refresh],
  )

  const decline = useCallback(
    async (id: string) => {
      if (!sync.config || !sync.session) return
      await declineHouseholdInvite(sync.config, sync.session, id)
      await refresh()
    },
    [sync.config, sync.session, refresh],
  )

  const revoke = useCallback(
    async (id: string) => {
      if (!sync.config || !sync.session) return
      await revokeHouseholdInvite(sync.config, sync.session, id)
      await refresh()
    },
    [sync.config, sync.session, refresh],
  )

  const unlink = useCallback(
    async (id: string) => {
      if (!sync.config || !sync.session) return
      await unlinkHousehold(sync.config, sync.session, id)
      await refresh()
    },
    [sync.config, sync.session, refresh],
  )

  // al abrir, al volver a la pestana, al recuperar conexion, y cada minuto
  // mientras haya sesion
  useEffect(() => {
    if (!sync.config || !sync.session) return
    void refresh()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    const id = setInterval(() => void refresh(), POLL_MS)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
      clearInterval(id)
    }
  }, [sync.config, sync.session, refresh])

  const api = useMemo<HouseholdApi>(
    () => ({
      status,
      message,
      links,
      sentPending: sent,
      receivedPending: received,
      partnerLink,
      partnerUserId,
      partnerData,
      invite,
      accept,
      decline,
      revoke,
      unlink,
      refresh,
    }),
    [
      status, message, links, sent, received, partnerLink, partnerUserId, partnerData,
      invite, accept, decline, revoke, unlink, refresh,
    ],
  )

  return <HouseholdContext.Provider value={api}>{children}</HouseholdContext.Provider>
}

export function useHousehold(): HouseholdApi {
  const ctx = useContext(HouseholdContext)
  if (!ctx) throw new Error('useHousehold debe usarse dentro de <HouseholdProvider>')
  return ctx
}
