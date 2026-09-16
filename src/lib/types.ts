/** Modelo de datos de la aplicacion. Todos los importes se guardan en yenes (JPY). */

export type Lang = 'es' | 'ja' | 'en'
export type ThemePref = 'system' | 'light' | 'dark'

/** Como se comporta un gasto en los totales del mes. */
export type ExpenseKind =
  /** gasto normal del mes */
  | 'normal'
  /** gasto que se repite todos los meses (suscripciones, movil, agua...) */
  | 'recurring'
  /** gasto extraordinario / puntual (mudanza, hotel, billetes de avion...) */
  | 'extraordinary'
  /** sin coste real: solo para dejar constancia (un regalo dado o recibido...) */
  | 'noCost'

/** Un "bucket" agrupa categorias para los indicadores del mes. */
export type Bucket =
  /** vida diaria: comida fuera + supermercado (一日生活の費消) */
  | 'daily'
  /** el resto: ocio, ropa, cosas de casa... (別の費消) */
  | 'other'

export interface Category {
  id: string
  /** nombre en el idioma del usuario */
  name: string
  /** nombre japones opcional, tal cual estaba en el Excel */
  nameJa?: string
  bucket: Bucket
  /** indice 0-7 de la paleta categorica */
  colorSlot: number
  archived?: boolean
  /** tope mensual de esta categoria, en yenes (0 o vacio = sin tope) */
  limitJpy?: number
  /** ISO. Lo usa la fusion al sincronizar para saber que version es mas nueva */
  updatedAt?: string
}

export interface Expense {
  id: string
  /** 'YYYY-MM' */
  monthId: string
  categoryId: string
  label: string
  /** importe en yenes */
  amount: number
  /** dia del mes 1-31, opcional */
  day?: number | null
  kind: ExpenseKind
  note?: string
  /** ISO. Lo usa la fusion al sincronizar para saber que version es mas nueva */
  updatedAt?: string
}

export interface FixedItem {
  id: string
  label: string
  /** importe en yenes */
  amount: number
}

export interface MonthData {
  /** 'YYYY-MM' */
  id: string
  /** alquiler en yenes (家賃) */
  rentJpy: number
  /** otros gastos fijos que no son filas de categoria (luz, gas, agua...) */
  extras: FixedItem[]
  /** tipo de cambio JPY -> moneda secundaria (為替相場) */
  fxRate: number
  /** limite de gasto del mes en yenes (上限) */
  limitJpy: number
  /** ingresos previstos del mes, en yenes: base de la prevision de ahorro */
  incomeJpy: number
  /**
   * Lo que de verdad entro ese mes, si se sabe. Solo lo usa "gasto sin
   * apuntar" (ver `unloggedSpend`), que necesita ingresos de verdad y no una
   * prevision. Vacio o 0 = sin poner: entonces se cae a `incomeJpy`.
   */
  actualIncomeJpy?: number
  note?: string
  updatedAt?: string
}

export interface Account {
  id: string
  name: string
  amount: number
  currency: 'JPY' | 'EUR'
  /** true = deuda (se resta del patrimonio) */
  isDebt?: boolean
  /**
   * 'YYYY-MM' del mes cuyo sobregasto genero esta cuenta automaticamente
   * (`autoDebtOnOverspend`). Es la marca que evita apuntar dos veces la
   * misma deuda: sobrevive a que se le cambie el nombre o el importe.
   */
  autoDebtMonthId?: string
}

/** Foto de los ahorros en una fecha concreta. */
export interface Snapshot {
  id: string
  /** 'YYYY-MM-DD' */
  date: string
  accounts: Account[]
  note?: string
  updatedAt?: string
}

export interface Settings {
  lang: Lang
  theme: ThemePref
  /** tipo de cambio por defecto para meses nuevos */
  defaultFxRate: number
  defaultLimitJpy: number
  defaultRentJpy: number
  /** ingresos previstos por defecto, en yenes: base de la prevision de ahorro */
  defaultIncomeJpy: number
  /**
   * Meta de ahorro. 0 = sin meta, y entonces la prevision no enseña ni la
   * linea ni la cuenta atras. Que significa la cifra lo dice
   * `savingsGoalMode`.
   */
  savingsGoalJpy: number
  /** plazo de la meta, en meses */
  savingsGoalMonths: number
  /**
   * Las dos maneras de decir una meta:
   *   'target' -> "quiero TENER 1.500.000" (cifra absoluta de patrimonio)
   *   'save'   -> "quiero AHORRAR 80.000" (sobre el punto de partida)
   */
  savingsGoalMode: 'target' | 'save'
  /**
   * Desde cuando se cuentan la meta y su plazo:
   *   'fixed'   -> desde el dia que se fijo (`savingsGoalStartJpy` y
   *                `savingsGoalStartMonthId`). Mide progreso: un mes malo te
   *                aleja del objetivo y el plazo no se mueve.
   *   'rolling' -> siempre desde hoy. Mide ritmo: un mes malo no te quita lo
   *                andado, pero tampoco se acumula lo ahorrado.
   */
  savingsGoalAnchor: 'fixed' | 'rolling'
  /** patrimonio del dia en que se fijo la meta (solo cuenta con 'fixed') */
  savingsGoalStartJpy?: number
  /** 'YYYY-MM' en que se fijo la meta (solo cuenta con 'fixed') */
  savingsGoalStartMonthId?: string
  /**
   * Plantilla de facturas fijas (agua, luz...) para un mes que no tiene uno
   * anterior del que copiar. Si ya hay un mes anterior, manda lo que haya en
   * el (ver `autoFillFixed`): esto solo evita arrancar en blanco el primero.
   */
  defaultExtras: FixedItem[]
  /** codigo de la moneda secundaria (la principal siempre es JPY) */
  secondaryCurrency: 'EUR' | 'USD' | 'GBP'
  /**
   * Al abrir un mes nuevo, copiar del anterior el alquiler, los extras fijos
   * y los gastos marcados como recurrentes.
   */
  autoFillFixed: boolean
  /** Traer el tipo de cambio de internet al abrir la app (una vez al dia). */
  autoFxRate: boolean
  /** ISO del ultimo dia en que se actualizo el tipo de cambio */
  fxUpdatedAt?: string
  /**
   * Al cerrar un mes por encima del limite, apuntar la diferencia como deuda
   * en Ahorros automaticamente. Solo mira el ultimo mes cerrado (el anterior
   * al de hoy), nunca meses mas viejos, y solo lo apunta una vez: la marca
   * `Account.autoDebtMonthId` es la que evita repetirlo.
   */
  autoDebtOnOverspend: boolean
  /** Donde aterriza esa deuda: en la ultima foto que haya, o en una nueva */
  autoDebtTarget: 'lastSnapshot' | 'newSnapshot'
  /**
   * Mi categoria X equivale a la categoria Y de mi pareja: para que la vista
   * "Juntos" (ver src/lib/householdCalc.ts) sume las dos como una sola,
   * aunque tengan id o nombre distintos en cada cuenta.
   */
  householdCategoryLinks: CategoryLink[]
}

/** Mi categoria equivale a esta otra en la cuenta de mi pareja. */
export interface CategoryLink {
  /** id de mi categoria */
  categoryId: string
  /** id de la categoria equivalente en el documento de mi pareja */
  partnerCategoryId: string
}

/** Marca de borrado, para que al sincronizar no resucite lo que borraste. */
export interface Tombstone {
  id: string
  /** ISO */
  at: string
}

export interface SyncState {
  /** ISO de la ultima subida/bajada correcta */
  lastSyncAt?: string
  /** valor de updatedAt del documento remoto en la ultima sincronizacion */
  lastRemoteAt?: string
  /** correo de la sesion activa, solo informativo: se borra al salir */
  email?: string
  /**
   * correo con el que se hizo la ultima sincronizacion correcta. A diferencia
   * de `email`, esto NO se borra al salir: sirve para detectar que este
   * dispositivo ya tenia datos de otra cuenta antes de fusionar con una
   * nueva sesion (ver `isAccountMismatch` en sync.ts).
   */
  lastSyncedEmail?: string
}

export interface AppData {
  version: number
  categories: Category[]
  expenses: Expense[]
  months: MonthData[]
  snapshots: Snapshot[]
  settings: Settings
  /** ISO del ultimo cambio en este dispositivo */
  updatedAt?: string
  /** identificadores borrados (gastos, meses, categorias, fotos, extras) */
  deleted?: Tombstone[]
  sync?: SyncState
}

export const DATA_VERSION = 2
