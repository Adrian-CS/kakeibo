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
      { id: '2026-07', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 200000 },
      { id: '2026-08', rentJpy: 80000, extras: [], fxRate: 0.0056, limitJpy: 200000 },
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

  it('cambia el idioma desde ajustes', async () => {
    const user = userEvent.setup()
    render(<App initial={seed()} />)
    await user.click(screen.getAllByRole('button', { name: /Ajustes/ })[0])
    const select = screen.getByLabelText('Idioma', { selector: 'select' })
    await user.selectOptions(select, 'ja')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('設定')
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
