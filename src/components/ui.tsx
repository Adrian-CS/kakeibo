import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactElement, ReactNode } from 'react'
import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from 'react'

/* ------------------------------------------------------------------ *
 * Contenedores
 * ------------------------------------------------------------------ */

export function Card({
  title,
  hint,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode
  hint?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-xl border border-hairline bg-surface p-3 sm:p-4 ${className}`}
    >
      {(title || actions) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h2 className="text-[13px] font-semibold tracking-wide text-ink uppercase">
                {title}
              </h2>
            )}
            {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

/* ------------------------------------------------------------------ *
 * Botones y controles
 * ------------------------------------------------------------------ */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger' | 'outline'
  size?: 'sm' | 'md'
}

export function Button({
  variant = 'ghost',
  size = 'md',
  className = '',
  ...rest
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none select-none'
  const sizes = {
    sm: 'h-8 px-2.5 text-xs',
    md: 'h-10 px-3.5 text-sm',
  }[size]
  const variants = {
    primary: 'bg-[var(--series-1)] text-white hover:opacity-90',
    ghost: 'text-ink-2 hover:bg-surface-2',
    outline: 'border border-hairline text-ink hover:bg-surface-2',
    danger: 'text-[var(--critical)] hover:bg-[color-mix(in_oklab,var(--critical)_12%,transparent)]',
  }[variant]
  return <button type="button" className={`${base} ${sizes} ${variants} ${className}`} {...rest} />
}

export function IconButton({
  label,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 hover:bg-surface-2 ${className}`}
      {...rest}
    />
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  id,
}: {
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
  label?: string
  id?: string
}) {
  return (
    <div
      id={id}
      role="group"
      aria-label={label}
      className="inline-flex rounded-lg border border-hairline bg-surface p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`h-8 rounded-md px-2.5 text-xs font-medium transition-colors ${
            value === o.id ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink-2'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-ink-2">
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-[var(--series-1)]' : 'bg-[var(--axis)]'
        }`}
      >
        <input
          type="checkbox"
          className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span
          className={`pointer-events-none ml-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-4' : ''
          }`}
        />
      </span>
      {label}
    </label>
  )
}

/* ------------------------------------------------------------------ *
 * Campos de formulario
 * ------------------------------------------------------------------ */

/**
 * Etiqueta + control. La asociacion es explicita (`for`/`id`): con la
 * etiqueta envolviendo al control algunos lectores de pantalla y utilidades
 * de test no la reconocen.
 */
export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  // useId() trae dos puntos, que rompen los selectores CSS: los quitamos
  const id = `f${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const child =
    isValidElement(children) && !(children.props as { id?: string }).id
      ? cloneElement(children as ReactElement<{ id?: string }>, { id })
      : children
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-ink-2">
        {label}
      </label>
      {child}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </div>
  )
}

const inputBase =
  'rounded-lg border border-hairline bg-surface px-2.5 py-2 text-sm text-ink placeholder:text-muted'

/**
 * Si quien usa el campo no dice nada del ancho, ocupa todo.
 * Se resuelve aqui y no con `w-full` en la base porque dos clases de ancho
 * en el mismo elemento las decide el orden del CSS, no el del atributo.
 */
function withWidth(cls: string): string {
  return /(^|\s)(w-|basis-|flex-1)/.test(cls) ? cls : `w-full ${cls}`
}

export function TextInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" className={`${inputBase} ${withWidth(className)}`} {...rest} />
}

/**
 * Entrada numerica: teclado numerico en movil y alineada a la derecha.
 *
 * Lleva su propio texto en local, en vez de mostrar directamente `value`:
 * quien la usa solo confirma el cambio cuando el texto ya se puede convertir
 * en numero (`parseAmount` devuelve null con "" o con un signo suelto), asi
 * que si el campo se controlase con `value` a pelo, en cuanto se borrara del
 * todo (o quedase a medio escribir) React lo devolveria de golpe al numero
 * de antes en la siguiente tecla -en movil eso se siente como que no deja
 * borrar ni sustituir la ultima cifra, porque el borrado nunca llega a
 * verse. Aqui se ve tal cual se escribe, y solo se resincroniza con `value`
 * cuando cambia por una razon ajena (otro dispositivo, deshacer, o porque el
 * propio dueño del campo confirmo un numero valido).
 */
export function NumberInput({
  value,
  onChange,
  onBlur,
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  const [text, setText] = useState(value == null ? '' : String(value))
  useEffect(() => setText(value == null ? '' : String(value)), [value])

  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={`${inputBase} text-right tabular-nums ${withWidth(className)}`}
      {...rest}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        onChange?.(e)
      }}
      onBlur={(e) => {
        // si lo que quedaba escrito no llego a confirmarse (vacio, un signo
        // suelto...), se vuelve a lo ultimo valido en vez de dejar el campo
        // enseñando algo que no es lo que hay guardado
        setText(value == null ? '' : String(value))
        onBlur?.(e)
      }}
    />
  )
}

export function Select({
  value,
  onChange,
  options,
  className = '',
  ariaLabel,
  id,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  className?: string
  ariaLabel?: string
  id?: string
}) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputBase} appearance-none pr-7 ${withWidth(className)}`}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'><path d='M2 4.5 6 8.5l4-4' fill='none' stroke='%23898781' stroke-width='1.5' stroke-linecap='round'/></svg>\")",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 8px center',
        backgroundSize: '12px',
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/* ------------------------------------------------------------------ *
 * Dialogo
 * ------------------------------------------------------------------ */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()

  // onClose suele ser una funcion nueva en cada render; si el efecto
  // dependiera de ella se reejecutaria en cada pulsacion y robaria el foco
  // al campo que estas escribiendo.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.querySelector<HTMLElement>('input, select, button')?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-10 max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl border border-hairline bg-surface p-4 sm:max-w-lg sm:rounded-2xl"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-base font-semibold text-ink">
            {title}
          </h2>
          <IconButton label="cerrar" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </IconButton>
        </div>
        {children}
        {footer && <div className="mt-4 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Indicadores
 * ------------------------------------------------------------------ */

export function StatTile({
  label,
  value,
  secondary,
  delta,
  deltaGood,
  hint,
  accent,
  children,
}: {
  label: string
  value: string
  secondary?: string
  delta?: string
  /** true = la variacion es buena (verde), false = mala (rojo) */
  deltaGood?: boolean
  hint?: string
  accent?: string
  children?: ReactNode
}) {
  return (
    // min-w-0: sin esto, un valor largo (importes grandes de varias cifras)
    // puede desbordar la celda en vez de encogerse, y en una rejilla de
    // varias columnas eso se ve como el numero cortado por el borde
    <div className="min-w-0 rounded-xl border border-hairline bg-surface p-3">
      <div className="flex items-center gap-1.5">
        {accent && (
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: accent }}
          />
        )}
        <span className="truncate text-xs text-ink-2">{label}</span>
      </div>
      <div className="mt-1 text-2xl leading-tight font-semibold break-words text-ink">{value}</div>
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
        {secondary && <span className="text-xs text-muted">{secondary}</span>}
        {delta && (
          <span
            className="text-xs font-medium"
            style={{
              color:
                deltaGood === undefined
                  ? 'var(--text-secondary)'
                  : deltaGood
                    ? 'var(--good-text)'
                    : 'var(--critical)',
            }}
          >
            {delta}
          </span>
        )}
      </div>
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
      {children}
    </div>
  )
}

/** Barra de progreso con color de estado. El track es una version clara del relleno. */
export function Meter({
  ratio,
  color,
  label,
}: {
  ratio: number
  color: string
  label: string
}) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full"
      role="progressbar"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      style={{ background: `color-mix(in oklab, ${color} 18%, var(--surface-2))` }}
    >
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Confirmacion en dos pasos (sin window.confirm, que en movil es horrible)
 * ------------------------------------------------------------------ */

export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel,
  variant = 'danger',
  size = 'sm',
}: {
  onConfirm: () => void
  children: ReactNode
  confirmLabel: string
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const id = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(id)
  }, [armed])
  return (
    <Button
      variant={armed ? 'danger' : variant}
      size={size}
      onClick={() => {
        if (armed) {
          onConfirm()
          setArmed(false)
        } else setArmed(true)
      }}
    >
      {armed ? confirmLabel : children}
    </Button>
  )
}

/* ------------------------------------------------------------------ *
 * Iconos (trazo de 1.5, 16px)
 * ------------------------------------------------------------------ */

export function Icon({ name, size = 16 }: { name: 'plus' | 'trash' | 'edit' | 'left' | 'right' | 'download' | 'upload' | 'undo'; size?: number }) {
  const paths: Record<string, ReactNode> = {
    plus: <path d="M8 3v10M3 8h10" />,
    trash: <path d="M3 5h10M6.5 5V3.5h3V5M5 5l.5 8h5l.5-8" />,
    edit: <path d="M11 2.5 13.5 5 6 12.5 3 13l.5-3z" />,
    left: <path d="M10 3 5 8l5 5" />,
    right: <path d="M6 3l5 5-5 5" />,
    download: <path d="M8 2v8m0 0 3-3m-3 3L5 7M3 13h10" />,
    upload: <path d="M8 11V3m0 0 3 3M8 3 5 6M3 13h10" />,
    undo: <path d="M4 8h6a3 3 0 1 1 0 6H7M4 8l3-3M4 8l3 3" />,
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}
