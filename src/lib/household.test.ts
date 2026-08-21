import { describe, expect, it, vi } from 'vitest'
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
} from './household'
import type { Session } from './supabase'

const CFG = { url: 'https://proyecto.supabase.co', anonKey: 'anon-123' }

function session(overrides: Partial<Session> = {}): Session {
  return {
    accessToken: 'token-1',
    refreshToken: 'refresh-1',
    expiresAt: Date.now() + 3_600_000,
    userId: 'user-1',
    email: 'yo@ejemplo.com',
    ...overrides,
  }
}

function okJson(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'link-1',
    inviter_id: 'user-1',
    invitee_email: 'pareja@ejemplo.com',
    invitee_id: null,
    status: 'pending',
    created_at: '2026-08-20T00:00:00Z',
    responded_at: null,
    ...overrides,
  }
}

describe('llamadas', () => {
  it('lista los vinculos y convierte los nombres de columna', async () => {
    const f = vi.fn().mockResolvedValue(okJson([row()]))
    const links = await listHouseholdLinks(CFG, session(), f)
    expect(f.mock.calls[0][0]).toContain('/rest/v1/household_links?select=*')
    expect(links).toEqual([
      {
        id: 'link-1',
        inviterId: 'user-1',
        inviteeEmail: 'pareja@ejemplo.com',
        inviteeId: null,
        status: 'pending',
        createdAt: '2026-08-20T00:00:00Z',
        respondedAt: null,
      },
    ])
  })

  it('invita por correo, en minusculas', async () => {
    const f = vi.fn().mockResolvedValue(okJson([row()]))
    await inviteHousehold(CFG, session(), 'Pareja@Ejemplo.com ', f)
    const body = JSON.parse(f.mock.calls[0][1].body)
    expect(body).toEqual([{ inviter_id: 'user-1', invitee_email: 'pareja@ejemplo.com' }])
  })

  it.each([
    ['acceptHouseholdInvite', acceptHouseholdInvite, 'accept_household_invite'],
    ['declineHouseholdInvite', declineHouseholdInvite, 'decline_household_invite'],
    ['revokeHouseholdInvite', revokeHouseholdInvite, 'revoke_household_invite'],
    ['unlinkHousehold', unlinkHousehold, 'unlink_household'],
  ] as const)('%s llama al rpc correcto', async (_name, fn, rpcName) => {
    const f = vi.fn().mockResolvedValue(okJson(null, 204))
    await fn(CFG, session(), 'link-1', f)
    expect(f.mock.calls[0][0]).toContain(`/rest/v1/rpc/${rpcName}`)
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ p_invite_id: 'link-1' })
  })
})

describe('piezas puras', () => {
  const base: HouseholdLink = {
    id: 'a',
    inviterId: 'user-1',
    inviteeEmail: 'pareja@ejemplo.com',
    inviteeId: 'user-2',
    status: 'accepted',
    createdAt: '2026-08-20T00:00:00Z',
    respondedAt: '2026-08-20T00:00:00Z',
  }

  it('activeLink encuentra el vinculo aceptado donde soy parte, sea invitador o invitado', () => {
    expect(activeLink([base], 'user-1')).toEqual(base)
    expect(activeLink([base], 'user-2')).toEqual(base)
    expect(activeLink([base], 'user-3')).toBeNull()
    expect(activeLink([{ ...base, status: 'pending' }], 'user-1')).toBeNull()
  })

  it('partnerIdOf devuelve el user_id del otro lado', () => {
    expect(partnerIdOf(base, 'user-1')).toBe('user-2')
    expect(partnerIdOf(base, 'user-2')).toBe('user-1')
  })

  it('sentPending y receivedPending separan segun quien invito', () => {
    const links: HouseholdLink[] = [
      { ...base, id: 'sent', status: 'pending', inviterId: 'user-1', inviteeId: null },
      { ...base, id: 'received', status: 'pending', inviterId: 'user-2', inviteeId: null },
      { ...base, id: 'accepted', status: 'accepted' },
    ]
    expect(sentPending(links, 'user-1').map((l) => l.id)).toEqual(['sent'])
    expect(receivedPending(links, 'user-1').map((l) => l.id)).toEqual(['received'])
  })
})
