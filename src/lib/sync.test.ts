import { describe, expect, it } from 'vitest'
import {
  isAccountMismatch,
  isBlankDevice,
  mergeById,
  mergeData,
  mergeReport,
  mergeTombstones,
  needsPush,
  newestIso,
  signature,
} from './sync'
import { emptyData } from './defaults'
import type { AppData, Expense } from './types'

const T1 = '2026-08-01T10:00:00.000Z'
const T2 = '2026-08-02T10:00:00.000Z'
const T3 = '2026-08-03T10:00:00.000Z'

function exp(id: string, amount: number, updatedAt?: string): Expense {
  return {
    id,
    monthId: '2026-08',
    categoryId: 'eating_out',
    label: id,
    amount,
    kind: 'normal',
    updatedAt,
  }
}

function doc(expenses: Expense[], updatedAt: string, extra: Partial<AppData> = {}): AppData {
  return { ...emptyData(new Date('2026-08-15T00:00:00')), expenses, updatedAt, ...extra }
}

describe('utilidades', () => {
  it('newestIso', () => {
    expect(newestIso(T1, T2)).toBe(T2)
    expect(newestIso(T2, T1)).toBe(T2)
    expect(newestIso(undefined, T1)).toBe(T1)
    expect(newestIso(T1, undefined)).toBe(T1)
    expect(newestIso()).toBe('')
  })

  it('mergeById se queda con la version mas nueva', () => {
    const mine = [exp('a', 100, T1), exp('b', 200, T3)]
    const theirs = [exp('a', 999, T2), exp('c', 300, T1)]
    const out = mergeById(mine, theirs, T1, T2)
    expect(out).toHaveLength(3)
    expect(out.find((e) => e.id === 'a')!.amount).toBe(999)
    expect(out.find((e) => e.id === 'b')!.amount).toBe(200)
    expect(out.find((e) => e.id === 'c')!.amount).toBe(300)
  })

  it('mergeById usa la fecha del documento si el apunte no la lleva', () => {
    const out = mergeById([exp('a', 1)], [exp('a', 2)], T3, T1)
    expect(out[0].amount).toBe(1)
  })

  it('mergeTombstones deduplica y ordena por fecha', () => {
    const out = mergeTombstones(
      [{ id: 'x', at: T1 }],
      [
        { id: 'x', at: T3 },
        { id: 'y', at: T2 },
      ],
    )
    expect(out).toEqual([
      { id: 'x', at: T3 },
      { id: 'y', at: T2 },
    ])
  })
})

describe('mergeData', () => {
  it('une los apuntes de los dos dispositivos', () => {
    const local = doc([exp('cafe', 400, T2)], T2)
    const remote = doc([exp('cerveza', 600, T1)], T1)
    const out = mergeData(local, remote)
    expect(out.expenses.map((e) => e.id).sort()).toEqual(['cafe', 'cerveza'])
    expect(out.updatedAt).toBe(T2)
  })

  it('en un conflicto gana el apunte editado mas tarde', () => {
    const local = doc([exp('a', 100, T1)], T1)
    const remote = doc([exp('a', 250, T3)], T3)
    expect(mergeData(local, remote).expenses[0].amount).toBe(250)
    expect(mergeData(remote, local).expenses[0].amount).toBe(250)
  })

  it('lo borrado en un dispositivo no vuelve desde el otro', () => {
    const local = doc([], T3, { deleted: [{ id: 'a', at: T3 }] })
    const remote = doc([exp('a', 100, T1)], T1)
    expect(mergeData(local, remote).expenses).toEqual([])
    // y al contrario, la marca de borrado viaja
    expect(mergeData(remote, local).expenses).toEqual([])
  })

  it('una edicion posterior al borrado gana', () => {
    const local = doc([], T1, { deleted: [{ id: 'a', at: T1 }] })
    const remote = doc([exp('a', 100, T3)], T3)
    expect(mergeData(local, remote).expenses).toHaveLength(1)
  })

  it('es simetrico', () => {
    const local = doc([exp('a', 1, T1), exp('b', 2, T3)], T3, { deleted: [{ id: 'z', at: T2 }] })
    const remote = doc([exp('a', 9, T2), exp('c', 3, T1)], T2)
    const ab = mergeData(local, remote)
    const ba = mergeData(remote, local)
    const key = (d: AppData) =>
      d.expenses
        .map((e) => `${e.id}:${e.amount}`)
        .sort()
        .join('|')
    expect(key(ab)).toBe(key(ba))
    expect(ab.deleted).toEqual(ba.deleted)
  })

  it('los ajustes vienen de la copia mas nueva', () => {
    const local = doc([], T1)
    local.settings = { ...local.settings, lang: 'ja' }
    const remote = doc([], T3)
    remote.settings = { ...remote.settings, lang: 'en' }
    expect(mergeData(local, remote).settings.lang).toBe('en')
    expect(mergeData(remote, local).settings.lang).toBe('en')
  })

  it('fusiona los extras de un mes uno a uno', () => {
    const base = emptyData(new Date('2026-08-15T00:00:00'))
    const local: AppData = {
      ...base,
      updatedAt: T2,
      months: [
        {
          id: '2026-08',
          rentJpy: 80000,
          fxRate: 0.0056,
          limitJpy: 200000,
          incomeJpy: 0,
          extras: [{ id: 'luz', label: 'luz', amount: 4000 }],
          updatedAt: T2,
        },
      ],
    }
    const remote: AppData = {
      ...base,
      updatedAt: T1,
      months: [
        {
          id: '2026-08',
          rentJpy: 80000,
          fxRate: 0.0056,
          limitJpy: 200000,
          incomeJpy: 0,
          extras: [{ id: 'agua', label: 'agua', amount: 3000 }],
          updatedAt: T1,
        },
      ],
    }
    const out = mergeData(local, remote)
    expect(out.months).toHaveLength(1)
    expect(out.months[0].extras.map((e) => e.id).sort()).toEqual(['agua', 'luz'])
  })

  it('el estado de sincronizacion no se importa del remoto', () => {
    const local = doc([], T2, { sync: { lastSyncAt: T2, email: 'yo@ejemplo.com' } })
    const remote = doc([], T1, { sync: { lastSyncAt: T1, email: 'otro@ejemplo.com' } })
    expect(mergeData(local, remote).sync?.email).toBe('yo@ejemplo.com')
  })

  it('la huella no depende del orden', () => {
    const a = doc([exp('a', 100, T1), exp('b', 200, T2)], T2)
    const b = doc([exp('b', 200, T2), exp('a', 100, T1)], T2)
    expect(signature(a)).toBe(signature(b))
    expect(signature(doc([exp('a', 100, T1)], T1))).not.toBe(signature(a))
  })

  it('la huella cambia con una edicion pura, sin alta ni baja', () => {
    // bug real: antes la huella solo miraba recuentos/sumas, asi que editar
    // un apunte que ya existia (sin tocar el importe) no cambiaba nada, y ni
    // la subida se disparaba ni la fusion se llegaba a aplicar en el otro lado
    const base = doc([exp('a', 100, T1)], T1)
    const relabelled = doc([{ ...exp('a', 100, T1), label: 'otro nombre' }], T1)
    const reNoted = doc([{ ...exp('a', 100, T1), note: 'nota nueva' }], T1)
    const reDayed = doc([{ ...exp('a', 100, T1), day: 5 }], T1)
    const reKinded = doc([{ ...exp('a', 100, T1), kind: 'recurring' }], T1)
    expect(signature(relabelled)).not.toBe(signature(base))
    expect(signature(reNoted)).not.toBe(signature(base))
    expect(signature(reDayed)).not.toBe(signature(base))
    expect(signature(reKinded)).not.toBe(signature(base))
  })

  it('la huella cambia al editar el mes, una categoria, los ajustes o un ahorro', () => {
    const base = doc([], T1)
    const month = { id: '2026-08', rentJpy: 80000, extras: [], fxRate: 0.005, limitJpy: 150000, incomeJpy: 0 }
    const withRent = doc([], T1, { months: [{ ...month, rentJpy: 90000 }] })
    const withoutRent = doc([], T1, { months: [month] })
    expect(signature(withRent)).not.toBe(signature(withoutRent))

    const cat = base.categories[0]
    const renamed = doc([], T1, { categories: [{ ...cat, name: 'Otro nombre' }] })
    expect(signature(renamed)).not.toBe(signature(base))

    const settingsChanged = doc([], T1, { settings: { ...base.settings, defaultLimitJpy: 999999 } })
    expect(signature(settingsChanged)).not.toBe(signature(base))

    const withSnapshot = doc([], T1, {
      snapshots: [{ id: 's', date: '2026-08-01', accounts: [{ id: 'a', name: 'x', amount: 100, currency: 'JPY' }] }],
    })
    const withEditedSnapshot = doc([], T1, {
      snapshots: [{ id: 's', date: '2026-08-01', accounts: [{ id: 'a', name: 'x', amount: 200, currency: 'JPY' }] }],
    })
    expect(signature(withSnapshot)).not.toBe(signature(withEditedSnapshot))
  })

  it('una edicion que llega de otro dispositivo se refleja al fusionar (no solo altas y bajas)', () => {
    // reproduce el bug de verdad: el otro dispositivo edito el importe de un
    // apunte que ya existia aqui, sin anadir ni borrar ninguno
    const local = doc([exp('a', 100, T1)], T1)
    const remote = doc([exp('a', 250, T2)], T2)
    const merged = mergeData(local, remote)
    expect(merged.expenses[0].amount).toBe(250)
    // esto es justo lo que decide si se aplica la fusion en state/sync.tsx
    expect(signature(merged)).not.toBe(signature(local))
  })

  it('needsPush', () => {
    const local = doc([exp('a', 100, T1)], T2)
    expect(needsPush(local, null)).toBe(true)
    expect(needsPush(local, doc([exp('a', 100, T1)], T1))).toBe(true)
    expect(needsPush(local, doc([exp('a', 100, T1)], T2))).toBe(false)
    // misma fecha pero al remoto le falta un apunte
    expect(needsPush(doc([exp('a', 1, T1), exp('b', 2, T1)], T2), doc([exp('a', 1, T1)], T2))).toBe(
      true,
    )
  })

  it('reconoce un dispositivo en blanco', () => {
    const blank = emptyData(new Date('2026-08-15T00:00:00'))
    expect(isBlankDevice(blank)).toBe(true)
    // el mes en curso, creado al abrir la app, no cuenta
    expect(isBlankDevice({ ...blank, months: [...blank.months] })).toBe(true)
    expect(isBlankDevice(doc([exp('a', 100, T1)], T1))).toBe(false)
    expect(isBlankDevice({ ...blank, deleted: [{ id: 'x', at: T1 }] })).toBe(false)
    expect(
      isBlankDevice({
        ...blank,
        snapshots: [{ id: 's', date: '2026-08-01', accounts: [] }],
      }),
    ).toBe(false)
    expect(
      isBlankDevice({
        ...blank,
        months: [{ ...blank.months[0], extras: [{ id: 'x', label: 'luz', amount: 4000 }] }],
      }),
    ).toBe(false)
  })

  it('detecta un cambio de cuenta en un dispositivo con datos de otra', () => {
    const withData = doc([exp('a', 100, T1)], T1, { sync: { lastSyncedEmail: 'a@x.com' } })
    // misma cuenta: no es un cambio
    expect(isAccountMismatch(withData, 'a@x.com')).toBe(false)
    // otra cuenta: si hay datos de verdad, es un cambio
    expect(isAccountMismatch(withData, 'b@y.com')).toBe(true)
    // sin sesion, o sesion sin correo: no se puede saber, no se bloquea
    expect(isAccountMismatch(withData, undefined)).toBe(false)
    // nunca se habia sincronizado con nadie: primer alta normal, no un cambio
    expect(isAccountMismatch(doc([exp('a', 100, T1)], T1), 'b@y.com')).toBe(false)
    // dispositivo en blanco: adoptar la nube es siempre seguro
    const blank = emptyData(new Date('2026-08-15T00:00:00'))
    expect(
      isAccountMismatch({ ...blank, sync: { lastSyncedEmail: 'a@x.com' } }, 'b@y.com'),
    ).toBe(false)
  })

  it('informa de lo que ha cambiado', () => {
    const local = doc([exp('a', 1, T1)], T1)
    const merged = doc([exp('a', 1, T1), exp('b', 2, T2)], T2)
    expect(mergeReport(local, merged)).toEqual({
      addedExpenses: 1,
      removedExpenses: 0,
      addedMonths: 0,
    })
  })
})
