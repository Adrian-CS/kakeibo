import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../App'
import { emptyData, monthIdOf } from '../lib/defaults'
import { shiftMonth } from '../lib/calc'
import type { AppData } from '../lib/types'
import { STORAGE_KEY } from '../lib/storage'

function seed(): AppData {
  const base = emptyData(new Date('2026-08-15T00:00:00'))
  return {
    ...base,
    months: [
      { id: '2026-07', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 200000, incomeJpy: 0 },
      { id: '2026-08', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 200000, incomeJpy: 0 },
    ],
    expenses: [
      { id: 'e1', monthId: '2026-07', categoryId: 'eating_out', label: 'uber', amount: 3000, kind: 'normal' },
      { id: 'e2', monthId: '2026-08', categoryId: 'groceries', label: 'seiyu', amount: 4000, kind: 'normal', day: 3 },
    ],
  }
}

/**
 * Un mes ya cerrado (el anterior a hoy) pasado de su limite, y el mes en
 * curso ya creado de antes -que es justo el caso que fallaba: al existir ya,
 * "al crear el mes siguiente" no volvia a pasar nunca-. Relativo a la fecha
 * real a proposito: la auditoria mira el ultimo mes cerrado de verdad, asi
 * que un fixture con meses fijos dejaria de valer al cambiar de mes.
 */
function closedOverLimitSeed(limitJpy: number): AppData {
  const closed = shiftMonth(monthIdOf(), -1)
  const current = monthIdOf()
  const month = (id: string, limit: number) => ({
    id,
    rentJpy: 80000,
    extras: [],
    fxRate: 0.0056,
    limitJpy: limit,
    incomeJpy: 0,
  })
  return {
    ...emptyData(),
    months: [month(closed, limitJpy), month(current, 200000)],
    expenses: [
      { id: 'e1', monthId: closed, categoryId: 'groceries', label: 'seiyu', amount: 4000, kind: 'normal' },
    ],
  }
}

/**
 * Un mes ya cerrado con gasto real y una suscripcion, mas una foto de
 * ahorros con una deuda: lo justo para las cifras de la pantalla Ahorros.
 * Relativo a la fecha real, igual que `closedOverLimitSeed`.
 */
function savingsSeed(): AppData {
  const base = emptyData()
  const closed = shiftMonth(monthIdOf(), -1)
  return {
    ...base,
    settings: { ...base.settings, defaultIncomeJpy: 200000 },
    months: [{ id: closed, rentJpy: 0, extras: [], fxRate: 0.0056, limitJpy: 200000, incomeJpy: 0 }],
    expenses: [
      { id: 'e1', monthId: closed, categoryId: 'groceries', label: 'seiyu', amount: 100000, kind: 'normal' },
      { id: 'e2', monthId: closed, categoryId: 'fixed_transport', label: 'netflix', amount: 1590, kind: 'recurring' },
    ],
    snapshots: [
      {
        id: 's1',
        date: `${closed}-28`,
        accounts: [
          { id: 'a1', name: 'banco', amount: 600000, currency: 'JPY' },
          { id: 'a2', name: 'tarjeta', amount: 50000, currency: 'JPY', isDebt: true },
        ],
      },
    ],
  }
}

beforeEach(() => {
  localStorage.clear()
  window.location.hash = '#/month/2026-08'
})

describe('la aplicacion', () => {
  it('muestra el mes con su total', () => {
    render(<App initial={seed()} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('2026')
    // 4000 + 80000 de alquiler
    expect(screen.getByText(/84[.,\s]?000/)).toBeInTheDocument()
  })

  it('borrar del todo un campo numerico y escribir otro numero no revierte al valor anterior', async () => {
    // regresion: NumberInput se controlaba directamente con el numero
    // guardado; en cuanto el campo quedaba vacio a medio borrar, React lo
    // devolvia de golpe al numero de antes en la siguiente tecla, y en
    // movil eso se sentia como que no dejaba borrar ni sustituir la ultima
    // cifra
    const user = userEvent.setup()
    render(<App initial={seed()} />)
    const rent = screen.getByLabelText('Alquiler')
    await user.clear(rent)
    expect(rent).toHaveValue('')
    await user.type(rent, '60000')
    expect(rent).toHaveValue('60000')
    await user.tab() // confirma el cambio (patch en el blur)
    // 60000 (alquiler nuevo) + 4000 (seiyu) = 64000
    expect(screen.getByText(/64[.,\s]?000/)).toBeInTheDocument()
  })

  it('el boton +/- deja anadir un importe negativo (p.ej. un reintegro recurrente de la empresa)', async () => {
    const user = userEvent.setup()
    render(<App initial={seed()} />)
    const conceptos = screen.getAllByPlaceholderText('Concepto')
    const importes = screen.getAllByPlaceholderText('0')
    const signos = screen.getAllByLabelText('Cambiar a positivo/negativo')
    await user.type(conceptos[0], 'reintegro transporte')
    await user.type(importes[0], '2000')
    await user.click(signos[0])
    expect(importes[0]).toHaveValue('-2000')
    await user.click(screen.getAllByLabelText('Añadir')[0])
    expect(screen.getByDisplayValue('reintegro transporte')).toBeInTheDocument()
    // 4000 (seiyu) + 80000 (alquiler) - 2000 (reintegro) = 82000
    expect(screen.getByText(/82[.,\s]?000/)).toBeInTheDocument()
  })

  it('el boton +/- de un gasto ya creado guarda el signo nuevo al momento, sin esperar a perder el foco', async () => {
    // regresion: el boton solo cambiaba el texto en pantalla y esperaba a
    // que el campo perdiera el foco para guardar (como con cualquier otra
    // tecla) - pero en movil ese guardado por perdida de foco no es fiable
    // (puede no llegar a dispararse, o hacerlo con el numero de antes de
    // tocar el boton), asi que se veia el cambio pero seguia sumando en vez
    // de restar. Ahora el propio boton guarda en el mismo gesto, sin
    // depender de ningun evento de foco despues
    const user = userEvent.setup()
    render(<App initial={seed()} />)
    const amount = screen.getByDisplayValue('4000')
    const row = amount.closest('li')!
    // sin tocar el campo antes (ni pulsar Tab despues): el boton solo
    await user.click(within(row).getByLabelText('Cambiar a positivo/negativo'))
    expect(amount).toHaveValue('-4000')
    // 80000 (alquiler) - 4000 (seiyu, ahora en negativo) = 76000
    expect(screen.getByText(/76[.,\s]?000/)).toBeInTheDocument()
  })

  it('la tarjeta de gastos fijos desglosa el total cuando hay recurrentes', () => {
    // regresion: la tarjeta solo ensena alquiler y extras, pero su total
    // incluye ademas los gastos recurrentes de las categorias. Con un abono
    // (recurrente negativo) el total salia mas bajo que la suma a la vista y
    // parecia mal sumado
    const data = seed()
    data.months[1].extras = [{ id: 'x1', label: 'agua', amount: 2000 }]
    data.expenses.push({
      id: 'e3',
      monthId: '2026-08',
      categoryId: 'fixed_transport',
      label: 'abono empresa',
      amount: -13550,
      kind: 'recurring',
    })
    render(<App initial={data} />)
    const desglose = screen.getByText(/Alquiler y extras/)
    expect(desglose).toHaveTextContent(/82[.,\s]?000/)
    expect(desglose).toHaveTextContent(/[-−]13[.,\s]?550/)
    // 80000 + 2000 - 13550 = 68450
    expect(screen.getByText(/Gastos fijos:/)).toHaveTextContent(/68[.,\s]?450/)
  })

  it('anade un gasto y actualiza el total', async () => {
    const user = userEvent.setup()
    render(<App initial={seed()} />)

    const conceptos = screen.getAllByPlaceholderText('Concepto')
    const importes = screen.getAllByPlaceholderText('0')
    await user.type(conceptos[0], 'mcdonals')
    await user.type(importes[0], '1000')
    await user.keyboard('{Enter}')

    expect(screen.getByDisplayValue('mcdonals')).toBeInTheDocument()
    expect(screen.getByText(/85[.,\s]?000/)).toBeInTheDocument()
  })

  it('guarda en el almacenamiento local', async () => {
    const user = userEvent.setup()
    render(<App initial={seed()} />)
    const importes = screen.getAllByPlaceholderText('0')
    await user.type(importes[0], '250')
    await user.keyboard('{Enter}')
    await new Promise((r) => setTimeout(r, 400))
    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!).expenses).toHaveLength(3)
  })

  it('cambia de mes con las flechas', async () => {
    const user = userEvent.setup()
    render(<App initial={seed()} />)
    await user.click(screen.getByLabelText('Mes anterior'))
    expect(screen.getByDisplayValue('uber')).toBeInTheDocument()
  })

  it('navega a estadisticas y dibuja los graficos', async () => {
    const user = userEvent.setup()
    render(<App initial={seed()} />)
    await user.click(screen.getAllByRole('button', { name: /Estadísticas/ })[0])
    expect(screen.getByText('Composición por categoría')).toBeInTheDocument()
    expect(screen.getByText('Dónde se va el dinero')).toBeInTheDocument()
    // el gemelo accesible del grafico
    await user.click(screen.getByLabelText('Mostrar tablas', { selector: 'input' }))
    expect(screen.getAllByRole('table').length).toBeGreaterThan(1)
  })

  it('el alta rapida crea el gasto en la categoria elegida', async () => {
    const user = userEvent.setup()
    render(<App initial={seed()} />)
    // el boton flotante solo se ve en movil, pero esta en el DOM
    await user.click(screen.getByRole('button', { name: 'Añadir gasto' }))
    const dialog = screen.getByRole('dialog')
    await user.selectOptions(within(dialog).getByLabelText('Categoría'), 'leisure')
    await user.type(within(dialog).getByLabelText('Concepto'), 'book off')
    await user.type(within(dialog).getByLabelText('Importe'), '1200')
    await user.selectOptions(within(dialog).getByLabelText('Tipo'), 'extraordinary')
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    expect(screen.getByDisplayValue('book off')).toBeInTheDocument()
    // 4000 + 80000 + 1200
    expect(screen.getByText(/85[.,\s]?200/)).toBeInTheDocument()
  })

  it('escribir en un dialogo no roba el foco ni lo cierra', async () => {
    // regresion: el efecto del dialogo dependia de onClose (funcion nueva en
    // cada render), asi que se reejecutaba en cada tecla y devolvia el foco
    // al primer campo
    const user = userEvent.setup()
    render(<App initial={seed()} />)
    await user.click(screen.getByRole('button', { name: 'Añadir gasto' }))
    const dialog = screen.getByRole('dialog')
    const concepto = within(dialog).getByLabelText('Concepto')
    await user.type(concepto, 'book off')
    expect(concepto).toHaveFocus()
    expect(concepto).toHaveValue('book off')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('al abrir un mes nuevo copia los fijos del anterior', async () => {
    const user = userEvent.setup()
    const data = seed()
    data.expenses.push({
      id: 'e3',
      monthId: '2026-08',
      categoryId: 'fixed_transport',
      label: 'netflix',
      amount: 1590,
      kind: 'recurring',
    })
    render(<App initial={data} />)
    await user.click(screen.getByLabelText('Mes siguiente'))
    // septiembre no existia: hereda alquiler y el gasto recurrente
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/septiembre|sept/i)
    expect(screen.getByDisplayValue('netflix')).toBeInTheDocument()
    expect(screen.getByDisplayValue('80000')).toBeInTheDocument()
    // pero no arrastra los gastos normales
    expect(screen.queryByDisplayValue('seiyu')).not.toBeInTheDocument()
  })

  it('con el ajuste de sobregasto activado, un mes cerrado por encima del limite genera deuda en Ahorros', async () => {
    // bug real: la deuda solo se apuntaba "al crear el mes siguiente", asi
    // que si ese mes ya existia -basta haber navegado hacia delante alguna
    // vez y quedan creados- no se apuntaba nunca. Aqui el mes en curso ya
    // existe en el fixture y aun asi tiene que apuntarse, sin navegar a nada
    const user = userEvent.setup()
    window.location.hash = `#/month/${monthIdOf()}`
    // el mes cerrado gasta 84000 (80000 de alquiler + 4000): 158 de sobregasto
    const data = closedOverLimitSeed(83842)
    data.settings = { ...data.settings, autoDebtOnOverspend: true, autoDebtTarget: 'lastSnapshot' }
    render(<App initial={data} />)
    await user.click(screen.getAllByRole('button', { name: /Ahorros/ })[0])
    expect(screen.getByDisplayValue(/Deuda generada/)).toBeInTheDocument()
    expect(screen.getByDisplayValue('158')).toBeInTheDocument()
  })

  it('no repite la deuda del mismo mes cerrado al navegar o volver a abrir', async () => {
    const user = userEvent.setup()
    window.location.hash = `#/month/${monthIdOf()}`
    const data = closedOverLimitSeed(50000)
    data.settings = { ...data.settings, autoDebtOnOverspend: true, autoDebtTarget: 'lastSnapshot' }
    render(<App initial={data} />)
    // cada navegacion vuelve a pasar por la auditoria del mes cerrado
    await user.click(screen.getByLabelText('Mes siguiente'))
    await user.click(screen.getByLabelText('Mes anterior'))
    await user.click(screen.getAllByRole('button', { name: /Ahorros/ })[0])
    // 84000 - 50000 = 34000, apuntado una sola vez
    expect(screen.getAllByDisplayValue(/Deuda generada/)).toHaveLength(1)
    expect(screen.getByDisplayValue('34000')).toBeInTheDocument()
  })

  it('Ahorros ensena las seis cifras de cabecera, lo que se debe y la fuga plegada', async () => {
    const user = userEvent.setup()
    window.location.hash = `#/month/${monthIdOf()}`
    render(<App initial={savingsSeed()} />)
    await user.click(screen.getAllByRole('button', { name: /Ahorros/ })[0])

    // las seis de la fila de arriba, ninguna en lugar de otra
    for (const label of [
      'Patrimonio neto',
      'Activos',
      'Deudas',
      'Tasa de ahorro',
      'Fuga',
      'Meses de colchón',
    ]) {
      // getAllBy: algunas etiquetas se repiten en la leyenda del grafico
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    // 200000 de ingreso - 101590 de gasto = 49 % de tasa de ahorro
    expect(screen.getByText('49 %')).toBeInTheDocument()

    // "Lo que debo": la cuenta marcada como deuda, con su total
    const debts = screen.getByRole('button', { name: /Lo que debo/ })
    expect(debts).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('tarjeta')).toBeInTheDocument()

    // la fuga arranca plegada, pero con su cifra a la vista
    const leak = screen.getByRole('button', { name: /Fuga: lo que se va solo/ })
    expect(leak).toHaveAttribute('aria-expanded', 'false')
    expect(within(leak).getByText(/1[.,\s]?590/)).toBeInTheDocument()
    expect(screen.getByText('netflix')).not.toBeVisible()

    await user.click(leak)
    expect(screen.getByText('netflix')).toBeVisible()
  })


  it('Ahorros ensena la prevision: tabla de escenarios, lo que viene y el examen del modelo', async () => {
    const user = userEvent.setup()
    window.location.hash = `#/month/${monthIdOf()}`
    render(<App initial={savingsSeed()} />)
    await user.click(screen.getAllByRole('button', { name: /Ahorros/ })[0])

    // las cuatro filas de escenarios, incluidas las dos que ya existian
    for (const row of ['Ritmo real', 'Banda p25–p75', 'Hasta el límite', 'Topes por categoría']) {
      expect(screen.getByRole('rowheader', { name: row })).toBeInTheDocument()
    }
    // y los tres plazos
    for (const col of ['6 meses', '1 año', '2 años']) {
      expect(screen.getByRole('columnheader', { name: col })).toBeInTheDocument()
    }
    // los techos se explican, para que nadie los lea como prevision
    expect(screen.getByText(/son techos y no previsiones/)).toBeInTheDocument()

    // sin meta puesta, la tarjeta dice donde ponerla
    expect(screen.getByText(/Pon una meta en Ajustes/)).toBeInTheDocument()

    // "lo que ya sabes que viene", abierta
    expect(
      screen.getByRole('button', { name: /Lo que ya sabes que viene/ }),
    ).toHaveAttribute('aria-expanded', 'true')

    // el examen del modelo arranca plegado; con un solo mes cerrado no hay
    // con que comprobarlo
    const backtest = screen.getByRole('button', { name: /Acierta esta previsión/ })
    expect(backtest).toHaveAttribute('aria-expanded', 'false')
    await user.click(backtest)
    expect(screen.getByText(/menos de cuatro meses cerrados/)).toBeInTheDocument()
  })

  it('con una meta puesta, la prevision dice lo que falta y si se llega a tiempo', async () => {
    const user = userEvent.setup()
    window.location.hash = `#/month/${monthIdOf()}`
    const data = savingsSeed()
    data.settings = { ...data.settings, savingsGoalJpy: 1000000, savingsGoalMonths: 12 }
    render(<App initial={data} />)
    await user.click(screen.getAllByRole('button', { name: /Ahorros/ })[0])

    // patrimonio 550000 de 1000000: faltan 450000
    expect(screen.getByText(/Te faltan/)).toBeInTheDocument()
    expect(screen.getByText(/dentro del plazo/)).toBeInTheDocument()
  })

  it('con el ajuste de sobregasto apagado, pasarse de limite no toca Ahorros', async () => {
    const user = userEvent.setup()
    window.location.hash = `#/month/${monthIdOf()}`
    render(<App initial={closedOverLimitSeed(50000)} />)
    await user.click(screen.getAllByRole('button', { name: /Ahorros/ })[0])
    expect(screen.queryByDisplayValue(/Deuda generada/)).not.toBeInTheDocument()
  })

  it('con el ajuste desactivado el mes nuevo sale vacio', async () => {
    const user = userEvent.setup()
    const data = seed()
    data.settings = { ...data.settings, autoFillFixed: false }
    data.expenses.push({
      id: 'e3',
      monthId: '2026-08',
      categoryId: 'fixed_transport',
      label: 'netflix',
      amount: 1590,
      kind: 'recurring',
    })
    render(<App initial={data} />)
    await user.click(screen.getByLabelText('Mes siguiente'))
    expect(screen.queryByDisplayValue('netflix')).not.toBeInTheDocument()
  })

  it('muestra el tope de una categoria', () => {
    const data = seed()
    data.categories = data.categories.map((c) =>
      c.id === 'groceries' ? { ...c, limitJpy: 30000 } : c,
    )
    render(<App initial={data} />)
    // 4000 gastados de 30000: quedan 26000
    expect(screen.getByText(/26[.,\s]?000/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Tope mensual: Supermercado/)).toBeInTheDocument()
  })

  it('la comparacion anual aparece en estadisticas', async () => {
    const user = userEvent.setup()
    const data = seed()
    data.months = [
      ...data.months,
      { id: '2025-08', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 200000, incomeJpy: 0 },
    ]
    data.expenses.push({
      id: 'e-2025-08',
      monthId: '2025-08',
      categoryId: 'eating_out',
      label: 'uber',
      amount: 10000,
      kind: 'normal',
    })
    render(<App initial={data} />)
    await user.click(screen.getAllByRole('button', { name: /Estadísticas/ })[0])
    expect(screen.getByText(/Comparado con el año pasado/)).toBeInTheDocument()
  })

  it('un mes anterior de solo fijos no cuenta para "vs mes anterior" (evita un salto enganoso)', async () => {
    // bug real: comparar contra un mes sin ningun apunte real (solo
    // alquiler) disparaba un "+104%" o similar, con el mes anterior
    // infravalorado por no tener gasto del dia a dia apuntado
    const user = userEvent.setup()
    const data = seed()
    data.expenses = data.expenses.filter((e) => e.id !== 'e1') // julio se queda solo con alquiler
    render(<App initial={data} />)
    await user.click(screen.getAllByRole('button', { name: /Estadísticas/ })[0])
    expect(screen.queryByText(/vs mes anterior/)).not.toBeInTheDocument()
  })

  it('sincronizacion: sin configurar pide los datos del proyecto', async () => {
    const user = userEvent.setup()
    render(<App initial={seed()} />)
    await user.click(screen.getAllByRole('button', { name: /Ajustes/ })[0])
    expect(screen.getByText('Sincronización')).toBeInTheDocument()
    expect(screen.getByLabelText('URL del proyecto')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Guardar configuración/ })).toBeDisabled()
  })

  it('cambia el idioma desde ajustes', async () => {
    const user = userEvent.setup()
    render(<App initial={seed()} />)
    await user.click(screen.getAllByRole('button', { name: /Ajustes/ })[0])
    const select = screen.getByLabelText('Idioma', { selector: 'select' })
    await user.selectOptions(select, 'ja')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('設定')
  })

  it('en japones las categorias por defecto se ven en japones, no en espanol', async () => {
    // bug real: category.name esta siempre en espanol (es el idioma con el
    // que se sembraron las 5 categorias por defecto); sin usar nameJa como
    // nombre a mostrar, quedaban en espanol aunque la interfaz estuviera en
    // japones
    const user = userEvent.setup()
    render(<App initial={seed()} />)
    await user.click(screen.getAllByRole('button', { name: /Ajustes/ })[0])
    await user.selectOptions(screen.getByLabelText('Idioma', { selector: 'select' }), 'ja')
    await user.click(screen.getAllByRole('button', { name: /^月$/ })[0])
    expect(screen.getByText('外食')).toBeInTheDocument()
    expect(screen.queryByText('Comer fuera')).not.toBeInTheDocument()
  })

  it('al borrar una categoria con gastos, se mueven a "Otros" en vez de perderse', async () => {
    const user = userEvent.setup()
    render(<App initial={seed()} />)
    await user.click(screen.getAllByRole('button', { name: /Ajustes/ })[0])

    const row = screen.getByDisplayValue('Supermercado').closest('li')!
    const buttons = within(row).getAllByRole('button')
    await user.click(buttons[buttons.length - 1]) // arma el borrado (icono, sin texto)
    await user.click(screen.getByRole('button', { name: /Mover 1 a "Otros"/ }))

    // el gasto sigue existiendo, ahora en "Otros", no borrado
    await user.click(screen.getAllByRole('button', { name: /^Mes$/ })[0])
    expect(screen.getByDisplayValue('seiyu')).toBeInTheDocument()
    expect(screen.getByText('Otros')).toBeInTheDocument()
  })

  it('borrar todo deja marcas de borrado, para que la sincronizacion no lo resucite', async () => {
    // regresion: un dispositivo recien vaciado se veia igual que uno recien
    // instalado (isBlankDevice), asi que la sincronizacion volvia a bajar la
    // copia vieja de la nube en cuanto se sincronizaba, deshaciendo el borrado
    const user = userEvent.setup()
    render(<App initial={seed()} />)
    await user.click(screen.getAllByRole('button', { name: /Ajustes/ })[0])
    await user.click(screen.getByRole('button', { name: 'Borrar todo' }))
    await user.click(screen.getByRole('button', { name: /Borrar todo — Confirmar/ }))

    await new Promise((r) => setTimeout(r, 400))
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(saved.expenses).toHaveLength(0)
    expect(saved.deleted.map((d: { id: string }) => d.id)).toEqual(expect.arrayContaining(['e1', 'e2']))
    // las categorias por defecto vuelven a crearse con el mismo id de
    // siempre: no deben nacer ya marcadas como borradas
    const defaultIds = saved.categories.map((c: { id: string }) => c.id)
    for (const id of defaultIds) {
      expect(saved.deleted.map((d: { id: string }) => d.id)).not.toContain(id)
    }
  })

  it('borra un gasto desde su ficha', async () => {
    const user = userEvent.setup()
    render(<App initial={seed()} />)
    await user.click(screen.getAllByLabelText('Editar')[0])
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Borrar' }))
    await user.click(within(dialog).getByRole('button', { name: /Borrar\?/ }))
    expect(screen.queryByDisplayValue('seiyu')).not.toBeInTheDocument()
  })
})
