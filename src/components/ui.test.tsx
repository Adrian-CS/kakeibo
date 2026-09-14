import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Collapsible } from './ui'

describe('Collapsible', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('la cabecera es un boton con aria-expanded y controla el cuerpo', async () => {
    const user = userEvent.setup()
    render(
      <Collapsible id="t1" title="Fuga" summary="1.590 ¥">
        <p>detalle</p>
      </Collapsible>,
    )
    const header = screen.getByRole('button', { name: /Fuga/ })
    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('detalle')).toBeVisible()

    await user.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('detalle')).not.toBeVisible()
  })

  it('cerrada ensena la cifra resumen, para que plegarla no esconda el dato', async () => {
    const user = userEvent.setup()
    render(
      <Collapsible id="t2" title="Fuga" summary="1.590 ¥" defaultOpen={false}>
        <p>detalle</p>
      </Collapsible>,
    )
    expect(screen.getByText('1.590 ¥')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Fuga/ }))
    // abierta no se repite: la cifra ya esta dentro
    expect(screen.queryByText('1.590 ¥')).not.toBeInTheDocument()
  })

  it('recuerda por id como se dejo', async () => {
    const user = userEvent.setup()
    const view = render(
      <Collapsible id="t3" title="Fuga">
        <p>detalle</p>
      </Collapsible>,
    )
    await user.click(screen.getByRole('button', { name: /Fuga/ }))
    view.unmount()

    render(
      <Collapsible id="t3" title="Fuga">
        <p>detalle</p>
      </Collapsible>,
    )
    expect(screen.getByRole('button', { name: /Fuga/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('lo guardado manda sobre defaultOpen, y cada id va por su cuenta', () => {
    localStorage.setItem('kakeibo:ui:collapsed:t4', '0')
    render(
      <>
        <Collapsible id="t4" title="Fuga" defaultOpen={false}>
          <p>detalle</p>
        </Collapsible>
        <Collapsible id="t5" title="Deudas" defaultOpen={false}>
          <p>otro</p>
        </Collapsible>
      </>,
    )
    expect(screen.getByRole('button', { name: /Fuga/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /Deudas/ })).toHaveAttribute('aria-expanded', 'false')
  })
})
