import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import type {
  AppData,
  Category,
  Expense,
  FixedItem,
  MonthData,
  Settings,
  Snapshot,
  SyncState,
} from '../lib/types'
import { loadData, saveData } from '../lib/storage'
import { monthIdOf, newMonth } from '../lib/defaults'
import { getMonth, shiftMonth } from '../lib/calc'
import { translator, type TFunc } from '../lib/i18n'
import { uid } from '../lib/id'
import { nowIso } from '../lib/sync'

type Action =
  | { type: 'replace'; data: AppData }
  /** como `replace`, pero conservando la fecha del documento fusionado */
  | { type: 'applyMerge'; data: AppData }
  | { type: 'ensureMonth'; monthId: string }
  | { type: 'patchMonth'; monthId: string; patch: Partial<MonthData> }
  | { type: 'addExpense'; expense: Omit<Expense, 'id'> }
  | { type: 'patchExpense'; id: string; patch: Partial<Expense> }
  | { type: 'deleteExpense'; id: string }
  | { type: 'addExtra'; monthId: string; extra: Omit<FixedItem, 'id'> }
  | { type: 'patchExtra'; monthId: string; id: string; patch: Partial<FixedItem> }
  | { type: 'deleteExtra'; monthId: string; id: string }
  | { type: 'copyFixed'; from: string; to: string }
  | { type: 'upsertCategory'; category: Category }
  | { type: 'deleteCategory'; id: string }
  | { type: 'moveCategory'; id: string; dir: -1 | 1 }
  | { type: 'upsertSnapshot'; snapshot: Snapshot }
  | { type: 'deleteSnapshot'; id: string }
  | { type: 'patchSettings'; patch: Partial<Settings> }
  | { type: 'patchSync'; patch: Partial<SyncState> }
  | { type: 'undo' }

interface State {
  data: AppData
  past: AppData[]
}

const MAX_HISTORY = 25
const MAX_TOMBSTONES = 2000

/**
 * Un cambio: entra en el historial de deshacer y sella la fecha del
 * documento, que es lo que usa la sincronizacion para saber que copia es
 * mas nueva.
 */
function withHistory(state: State, data: AppData): State {
  return {
    data: { ...data, updatedAt: nowIso() },
    past: [state.data, ...state.past].slice(0, MAX_HISTORY),
  }
}

/** Anota que algo se ha borrado, para que la fusion no lo resucite. */
function tomb(data: AppData, ...ids: string[]): AppData['deleted'] {
  const at = nowIso()
  return [...ids.map((id) => ({ id, at })), ...(data.deleted ?? [])].slice(0, MAX_TOMBSTONES)
}

/**
 * Crea el mes si no existe. Con `autoFillFixed` copia del mes anterior el
 * alquiler, el ingreso previsto, los extras y los gastos recurrentes, para no
 * teclearlos cada mes. Solo rellena desde un mes anterior que exista, y nunca
 * meses muy futuros.
 */
function ensureMonth(data: AppData, monthId: string): AppData {
  if (data.months.some((m) => m.id === monthId)) return data

  const fresh = newMonth(monthId, data.settings)
  const prevId = shiftMonth(monthId, -1)
  const prev = data.months.find((m) => m.id === prevId)
  const tooFar = monthId > shiftMonth(monthIdOf(), 1)

  if (!data.settings.autoFillFixed || !prev || tooFar) {
    return { ...data, months: [...data.months, fresh] }
  }

  const at = nowIso()
  const recurring = data.expenses
    .filter((e) => e.monthId === prevId && e.kind === 'recurring')
    .map((e) => ({ ...e, id: uid('e'), monthId, day: null, updatedAt: at }))

  return {
    ...data,
    expenses: [...data.expenses, ...recurring],
    months: [
      ...data.months,
      {
        ...fresh,
        rentJpy: prev.rentJpy,
        fxRate: prev.fxRate,
        limitJpy: prev.limitJpy,
        incomeJpy: prev.incomeJpy,
        extras: prev.extras.map((x) => ({ ...x, id: uid('x') })),
        updatedAt: at,
      },
    ],
  }
}

function reducer(state: State, action: Action): State {
  const { data } = state
  switch (action.type) {
    case 'replace':
      return withHistory(state, action.data)

    case 'applyMerge':
      return {
        data: action.data,
        past: [state.data, ...state.past].slice(0, MAX_HISTORY),
      }

    case 'ensureMonth': {
      const next = ensureMonth(data, action.monthId)
      return next === data ? state : withHistory(state, next)
    }

    case 'patchMonth': {
      const base = ensureMonth(data, action.monthId)
      return withHistory(state, {
        ...base,
        months: base.months.map((m) =>
          m.id === action.monthId ? { ...m, ...action.patch, updatedAt: nowIso() } : m,
        ),
      })
    }

    case 'addExpense': {
      const base = ensureMonth(data, action.expense.monthId)
      return withHistory(state, {
        ...base,
        expenses: [...base.expenses, { ...action.expense, id: uid('e'), updatedAt: nowIso() }],
      })
    }

    case 'patchExpense':
      return withHistory(state, {
        ...data,
        expenses: data.expenses.map((e) =>
          e.id === action.id ? { ...e, ...action.patch, updatedAt: nowIso() } : e,
        ),
      })

    case 'deleteExpense':
      return withHistory(state, {
        ...data,
        expenses: data.expenses.filter((e) => e.id !== action.id),
        deleted: tomb(data, action.id),
      })

    case 'addExtra': {
      const base = ensureMonth(data, action.monthId)
      return withHistory(state, {
        ...base,
        months: base.months.map((m) =>
          m.id === action.monthId
            ? { ...m, extras: [...m.extras, { ...action.extra, id: uid('x') }], updatedAt: nowIso() }
            : m,
        ),
      })
    }

    case 'patchExtra':
      return withHistory(state, {
        ...data,
        months: data.months.map((m) =>
          m.id === action.monthId
            ? {
                ...m,
                extras: m.extras.map((x) => (x.id === action.id ? { ...x, ...action.patch } : x)),
                updatedAt: nowIso(),
              }
            : m,
        ),
      })

    case 'deleteExtra':
      return withHistory(state, {
        ...data,
        months: data.months.map((m) =>
          m.id === action.monthId
            ? { ...m, extras: m.extras.filter((x) => x.id !== action.id), updatedAt: nowIso() }
            : m,
        ),
        deleted: tomb(data, action.id),
      })

    case 'copyFixed': {
      const src = getMonth(data, action.from)
      if (!src) return state
      const base = ensureMonth(data, action.to)
      const recurring = base.expenses
        .filter((e) => e.monthId === action.from && e.kind === 'recurring')
        .map((e) => ({ ...e, id: uid('e'), monthId: action.to, day: null }))
      const already = new Set(
        base.expenses
          .filter((e) => e.monthId === action.to && e.kind === 'recurring')
          .map((e) => `${e.categoryId}|${e.label.toLowerCase()}`),
      )
      return withHistory(state, {
        ...base,
        expenses: [
          ...base.expenses,
          ...recurring.filter((e) => !already.has(`${e.categoryId}|${e.label.toLowerCase()}`)),
        ],
        months: base.months.map((m) =>
          m.id === action.to
            ? {
                ...m,
                rentJpy: src.rentJpy,
                fxRate: src.fxRate,
                limitJpy: src.limitJpy,
                extras: m.extras.length ? m.extras : src.extras.map((x) => ({ ...x, id: uid('x') })),
              }
            : m,
        ),
      })
    }

    case 'upsertCategory': {
      const exists = data.categories.some((c) => c.id === action.category.id)
      return withHistory(state, {
        ...data,
        categories: exists
          ? data.categories.map((c) => (c.id === action.category.id ? action.category : c))
          : [...data.categories, action.category],
      })
    }

    case 'deleteCategory':
      return withHistory(state, {
        ...data,
        categories: data.categories.filter((c) => c.id !== action.id),
        expenses: data.expenses.filter((e) => e.categoryId !== action.id),
        deleted: tomb(
          data,
          action.id,
          ...data.expenses.filter((e) => e.categoryId === action.id).map((e) => e.id),
        ),
      })

    case 'moveCategory': {
      const i = data.categories.findIndex((c) => c.id === action.id)
      const j = i + action.dir
      if (i < 0 || j < 0 || j >= data.categories.length) return state
      const cats = [...data.categories]
      ;[cats[i], cats[j]] = [cats[j], cats[i]]
      return withHistory(state, { ...data, categories: cats })
    }

    case 'upsertSnapshot': {
      const exists = data.snapshots.some((s) => s.id === action.snapshot.id)
      const stamped = { ...action.snapshot, updatedAt: nowIso() }
      return withHistory(state, {
        ...data,
        snapshots: exists
          ? data.snapshots.map((s) => (s.id === action.snapshot.id ? stamped : s))
          : [...data.snapshots, stamped],
      })
    }

    case 'deleteSnapshot':
      return withHistory(state, {
        ...data,
        snapshots: data.snapshots.filter((s) => s.id !== action.id),
        deleted: tomb(data, action.id),
      })

    case 'patchSettings':
      return withHistory(state, { ...data, settings: { ...data.settings, ...action.patch } })

    // el estado de sincronizacion es local: no cuenta como cambio del
    // documento ni entra en el historial de deshacer
    case 'patchSync':
      return { ...state, data: { ...data, sync: { ...data.sync, ...action.patch } } }

    case 'undo': {
      const [prev, ...rest] = state.past
      if (!prev) return state
      return { data: prev, past: rest }
    }

    default:
      return state
  }
}

export interface Store {
  data: AppData
  dispatch: (a: Action) => void
  canUndo: boolean
  t: TFunc
  /** clave de la moneda secundaria activa */
  secondary: string
}

const StoreContext = createContext<Store | null>(null)

export function StoreProvider({ children, initial }: { children: ReactNode; initial?: AppData }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    data: initial ?? loadData(),
    past: [] as AppData[],
  }))

  // guardado diferido: escribir en cada pulsacion de tecla es innecesario
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => saveData(state.data), 250) as unknown as number
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [state.data])

  // guardar tambien al cerrar / cambiar de app (movil mata la pestana sin avisar)
  useEffect(() => {
    const flush = () => saveData(state.data)
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', flush)
    }
  }, [state.data])

  // tema
  useEffect(() => {
    const el = document.documentElement
    if (state.data.settings.theme === 'system') el.removeAttribute('data-theme')
    else el.setAttribute('data-theme', state.data.settings.theme)
  }, [state.data.settings.theme])

  // idioma del documento (afecta a la particion de linea en japones)
  useEffect(() => {
    document.documentElement.lang = state.data.settings.lang
  }, [state.data.settings.lang])

  const t = useMemo(() => translator(state.data.settings.lang), [state.data.settings.lang])

  const value = useMemo<Store>(
    () => ({
      data: state.data,
      dispatch,
      canUndo: state.past.length > 0,
      t,
      secondary: state.data.settings.secondaryCurrency,
    }),
    [state.data, state.past.length, t],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore debe usarse dentro de <StoreProvider>')
  return ctx
}

/** Mes seleccionado, sincronizado con el hash de la URL (#/2026-08). */
export function useCurrentMonth(): [string, (id: string) => void] {
  const { dispatch } = useStore()
  const fromHash = () => {
    const m = /(\d{4})-(\d{2})/.exec(window.location.hash)
    return m ? `${m[1]}-${m[2]}` : monthIdOf()
  }
  const [monthId, setMonthId] = useReducer(
    (_: string, next: string) => next,
    undefined,
    fromHash,
  )

  useEffect(() => {
    dispatch({ type: 'ensureMonth', monthId })
  }, [monthId, dispatch])

  const set = useCallback((id: string) => setMonthId(id), [])
  return [monthId, set]
}

export type { Action }
