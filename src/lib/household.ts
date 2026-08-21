/**
 * Vinculo de pareja: dos cuentas de Supabase separadas que se dejan leer
 * (nunca escribir) la una a la otra, una vez aceptada la invitacion.
 *
 * Mismo estilo que `supabase.ts` (fetch puro, sin SDK oficial). La tabla
 * `household_links` y sus politicas/funciones viven en
 * `supabase/household_schema.sql`.
 */
import { call, type Fetcher, type Session, type SupabaseConfig } from './supabase'

export const HOUSEHOLD_TABLE = 'household_links'

export type HouseholdStatus = 'pending' | 'accepted' | 'declined' | 'revoked'

export interface HouseholdLink {
  id: string
  inviterId: string
  inviteeEmail: string
  inviteeId: string | null
  status: HouseholdStatus
  createdAt: string
  respondedAt: string | null
}

interface HouseholdLinkRow {
  id: string
  inviter_id: string
  invitee_email: string
  invitee_id: string | null
  status: HouseholdStatus
  created_at: string
  responded_at: string | null
}

function fromRow(r: HouseholdLinkRow): HouseholdLink {
  return {
    id: r.id,
    inviterId: r.inviter_id,
    inviteeEmail: r.invitee_email,
    inviteeId: r.invitee_id,
    status: r.status,
    createdAt: r.created_at,
    respondedAt: r.responded_at,
  }
}

/** Todos los vinculos/invitaciones que me tocan: la RLS ya filtra el resto. */
export async function listHouseholdLinks(
  cfg: SupabaseConfig,
  session: Session,
  f: Fetcher = fetch,
): Promise<HouseholdLink[]> {
  const rows = await call<HouseholdLinkRow[]>(
    cfg,
    `/rest/v1/${HOUSEHOLD_TABLE}?select=*&order=created_at.desc`,
    { method: 'GET', headers: { Authorization: `Bearer ${session.accessToken}` } },
    f,
  )
  return (rows ?? []).map(fromRow)
}

/** Invita a alguien por correo. No hace falta conocer su user_id. */
export async function inviteHousehold(
  cfg: SupabaseConfig,
  session: Session,
  email: string,
  f: Fetcher = fetch,
): Promise<HouseholdLink> {
  const rows = await call<HouseholdLinkRow[]>(
    cfg,
    `/rest/v1/${HOUSEHOLD_TABLE}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.accessToken}`, Prefer: 'return=representation' },
      body: JSON.stringify([{ inviter_id: session.userId, invitee_email: email.trim().toLowerCase() }]),
    },
    f,
  )
  return fromRow(rows[0])
}

async function rpc(
  cfg: SupabaseConfig,
  session: Session,
  fn: string,
  inviteId: string,
  f: Fetcher,
): Promise<void> {
  await call<unknown>(
    cfg,
    `/rest/v1/rpc/${fn}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify({ p_invite_id: inviteId }),
    },
    f,
  )
}

export async function acceptHouseholdInvite(
  cfg: SupabaseConfig,
  session: Session,
  inviteId: string,
  f: Fetcher = fetch,
): Promise<void> {
  return rpc(cfg, session, 'accept_household_invite', inviteId, f)
}

export async function declineHouseholdInvite(
  cfg: SupabaseConfig,
  session: Session,
  inviteId: string,
  f: Fetcher = fetch,
): Promise<void> {
  return rpc(cfg, session, 'decline_household_invite', inviteId, f)
}

export async function revokeHouseholdInvite(
  cfg: SupabaseConfig,
  session: Session,
  inviteId: string,
  f: Fetcher = fetch,
): Promise<void> {
  return rpc(cfg, session, 'revoke_household_invite', inviteId, f)
}

export async function unlinkHousehold(
  cfg: SupabaseConfig,
  session: Session,
  linkId: string,
  f: Fetcher = fetch,
): Promise<void> {
  return rpc(cfg, session, 'unlink_household', linkId, f)
}

/* ------------------------------------------------------------------ *
 * Piezas puras, sin red: para derivar el estado visible de la lista
 * ------------------------------------------------------------------ */

/** El vinculo ya aceptado donde soy una de las dos partes, si lo hay. */
export function activeLink(links: HouseholdLink[], myUserId: string): HouseholdLink | null {
  return links.find((l) => l.status === 'accepted' && (l.inviterId === myUserId || l.inviteeId === myUserId)) ?? null
}

/** El user_id de la otra parte de un vinculo, dado el mio. */
export function partnerIdOf(link: HouseholdLink, myUserId: string): string {
  return link.inviterId === myUserId ? (link.inviteeId ?? '') : link.inviterId
}

/** Invitaciones que yo mande y siguen pendientes de respuesta. */
export function sentPending(links: HouseholdLink[], myUserId: string): HouseholdLink[] {
  return links.filter((l) => l.status === 'pending' && l.inviterId === myUserId)
}

/** Invitaciones que me mandan a mi y todavia no he respondido. */
export function receivedPending(links: HouseholdLink[], myUserId: string): HouseholdLink[] {
  return links.filter((l) => l.status === 'pending' && l.inviterId !== myUserId)
}
