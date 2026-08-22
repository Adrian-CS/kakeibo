import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../App'
import { emptyData } from '../lib/defaults'
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

  it('con el ajuste de sobregasto activado, cerrar un mes pasado de limite genera una deuda en Ahorros', async () => {
    const user = userEvent.setup()
    const data = seed()
    data.settings = { ...data.settings, autoDebtOnOverspend: true, autoDebtTarget: 'lastSnapshot' }
    // agosto: 80000 (alquiler) + 4000 (seiyu) = 84000, por encima de un limite de 50000
    data.months = data.months.map((m) => (m.id === '2026-08' ? { ...m, limitJpy: 50000 } : m))
    render(<App initial={data} />)
    await user.click(screen.getByLabelText('Mes siguiente'))
    await user.click(screen.getAllByRole('button', { name: /Ahorros/ })[0])
    expect(screen.getByDisplayValue(/Deuda generada 26-08-31/)).toBeInTheDocument()
    // 84000 - 50000 = 34000 de deuda
    expect(screen.getByDisplayValue('34000')).toBeInTheDocument()
  })

  it('con el ajuste de sobregasto apagado, pasarse de limite no toca Ahorros', async () => {
    const user = userEvent.setup()
    const data = seed()
    data.months = data.months.map((m) => (m.id === '2026-08' ? { ...m, limitJpy: 50000 } : m))
    render(<App initial={data} />)
    await user.click(screen.getByLabelText('Mes siguiente'))
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
