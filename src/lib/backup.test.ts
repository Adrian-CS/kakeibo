import { describe, expect, it } from 'vitest'
import {
  backupId,
  backupsToKeep,
  runDailyBackup,
  type BackupEntry,
  type BackupMeta,
  type BackupStore,
} from './backup'
import { emptyData } from './defaults'
import type { AppData } from './types'

/** Un almacen en memoria, para probar la logica sin IndexedDB de por medio. */
function memoryStore(seed: BackupEntry[] = []): BackupStore & { entries: Map<string, BackupEntry> } {
  const entries = new Map(seed.map((e) => [e.id, e]))
  return {
    entries,
    async list() {
      return [...entries.values()].map(({ id, at, size }) => ({ id, at, size }))
    },
    async read(id) {
      return entries.get(id)?.json ?? null
    },
    async write(entry) {
      entries.set(entry.id, entry)
    },
    async remove(id) {
      entries.delete(id)
    },
  }
}

function meta(id: string): BackupMeta {
  return { id, at: `${id}T12:00:00.000Z`, size: 100 }
}

describe('copias automaticas', () => {
  const today = new Date('2026-10-09T10:00:00')

  it('la copia se identifica por el dia', () => {
    expect(backupId(new Date('2026-10-09T23:59:00'))).toBe('2026-10-09')
    expect(backupId(new Date('2026-01-05T00:00:00'))).toBe('2026-01-05')
  })

  describe('que copias se quedan', () => {
    it('guarda las siete ultimas diarias', () => {
      const metas = Array.from({ length: 10 }, (_, i) =>
        meta(`2026-10-${String(i + 1).padStart(2, '0')}`),
      )
      const keep = backupsToKeep(metas, today, { daily: 7, months: 12 })
      // del 10 al 4 se quedan; del 3 para atras solo sobrevive la ultima del
      // mes, que ya esta entre las siete
      expect(keep).toContain('2026-10-10')
      expect(keep).toContain('2026-10-04')
      expect(keep).not.toContain('2026-10-03')
      expect(keep).toHaveLength(7)
    })

    it('guarda ademas la ultima copia de cada mes', () => {
      const metas = [
        meta('2026-10-09'),
        meta('2026-09-28'),
        meta('2026-09-02'),
        meta('2026-08-31'),
        meta('2026-08-01'),
      ]
      const keep = backupsToKeep(metas, today, { daily: 2, months: 12 })
      // las dos ultimas diarias (9 oct y 28 sep) y el cierre de agosto. Del
      // resto de cada mes no se guarda nada
      expect([...keep].sort()).toEqual(['2026-08-31', '2026-09-28', '2026-10-09'])
      expect(keep).not.toContain('2026-09-02')
      expect(keep).not.toContain('2026-08-01')
    })

    it('tira lo mas viejo que la ventana de meses', () => {
      const metas = [meta('2026-10-09'), meta('2025-10-31'), meta('2025-09-30')]
      const keep = backupsToKeep(metas, today, { daily: 1, months: 12 })
      // noviembre de 2025 en adelante: octubre de 2025 entra justo, septiembre no
      expect(keep).toContain('2026-10-09')
      expect(keep).not.toContain('2025-09-30')
    })

    it('sin copias no se queda nada, y no se rompe', () => {
      expect(backupsToKeep([], today)).toEqual([])
    })
  })

  describe('la copia del dia', () => {
    const data: AppData = emptyData(today)

    it('guarda la de hoy con el documento entero', async () => {
      const store = memoryStore()
      const metas = await runDailyBackup(store, data, today)
      expect(metas.map((m) => m.id)).toEqual(['2026-10-09'])
      const json = await store.read('2026-10-09')
      // el mismo formato que la copia manual: se puede importar tal cual
      expect(JSON.parse(json!).version).toBe(data.version)
    })

    it('la vuelve a pisar el mismo dia, para quedarse con la ultima foto', async () => {
      const store = memoryStore()
      await runDailyBackup(store, data, today)
      const conGasto: AppData = {
        ...data,
        expenses: [
          { id: 'e1', monthId: '2026-10', categoryId: 'eating_out', label: 'x', amount: 500, kind: 'normal' },
        ],
      }
      const metas = await runDailyBackup(store, conGasto, new Date('2026-10-09T22:00:00'))
      expect(metas).toHaveLength(1)
      expect(JSON.parse((await store.read('2026-10-09'))!).expenses).toHaveLength(1)
    })

    it('poda las que sobran al guardar', async () => {
      const viejas: BackupEntry[] = ['2026-10-08', '2026-10-07', '2024-01-02'].map((id) => ({
        ...meta(id),
        json: '{}',
      }))
      const store = memoryStore(viejas)
      const metas = await runDailyBackup(store, data, today, { daily: 2, months: 12 })
      expect(metas.map((m) => m.id)).toEqual(['2026-10-09', '2026-10-08'])
      // la de hace dos anos se va: ni esta entre las recientes ni cae dentro
      // de la ventana de meses
      expect(await store.read('2024-01-02')).toBeNull()
    })

    it('sin almacen no hace nada, en vez de reventar', async () => {
      expect(await runDailyBackup(null, data, today)).toEqual([])
    })

    it('un almacen que falla no tira la app', async () => {
      const roto: BackupStore = {
        list: async () => {
          throw new Error('nope')
        },
        read: async () => null,
        write: async () => {
          throw new Error('nope')
        },
        remove: async () => {},
      }
      expect(await runDailyBackup(roto, data, today)).toEqual([])
    })
  })
})
