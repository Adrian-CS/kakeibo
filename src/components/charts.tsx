import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/* ------------------------------------------------------------------ *
 * Medida del contenedor: los SVG se dibujan al ancho real, nunca
 * escalados (escalar deforma el texto y engorda los trazos).
 * ------------------------------------------------------------------ */

export function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  // null! : el ref se rellena al montar; los usos comprueban ref.current
  const ref = useRef<T>(null!)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setW(el.clientWidth)
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

/* ------------------------------------------------------------------ *
 * Piezas comunes
 * ------------------------------------------------------------------ */

export interface Series {
  key: string
  label: string
  color: string
}

export function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null
  return (
    <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5 text-[11px] text-ink-2">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
            style={{ background: s.color }}
          />
          <span className="truncate">{s.label}</span>
        </li>
      ))}
    </ul>
  )
}

function Tooltip({
  x,
  y,
  width,
  children,
}: {
  x: number
  y: number
  width: number
  children: ReactNode
}) {
  const W = 168
  const left = Math.max(4, Math.min(width - W - 4, x - W / 2))
  return (
    <div
      className="pointer-events-none absolute z-10 rounded-lg border border-hairline bg-surface px-2.5 py-2 text-xs shadow-lg"
      style={{ left, top: Math.max(4, y), width: W }}
    >
      {children}
    </div>
  )
}

export function TooltipRow({
  color,
  label,
  value,
  strong,
}: {
  color?: string
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5">
        {color && (
          <span
            aria-hidden="true"
            className="h-[2px] w-3 shrink-0 rounded-full"
            style={{ background: color }}
          />
        )}
        <span className="truncate text-muted">{label}</span>
      </span>
      <span className={`shrink-0 tabular-nums ${strong ? 'font-semibold text-ink' : 'text-ink-2'}`}>
        {value}
      </span>
    </div>
  )
}

/** Path de barra con las esquinas del extremo redondeadas (4px) y base recta. */
function barPathUp(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.max(0, Math.min(r, w / 2, h))
  return [
    `M${x},${y + h}`,
    `V${y + rr}`,
    `Q${x},${y} ${x + rr},${y}`,
    `H${x + w - rr}`,
    `Q${x + w},${y} ${x + w},${y + rr}`,
    `V${y + h}`,
    'Z',
  ].join(' ')
}

function barPathRight(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.max(0, Math.min(r, h / 2, w))
  return [
    `M${x},${y}`,
    `H${x + w - rr}`,
    `Q${x + w},${y} ${x + w},${y + rr}`,
    `V${y + h - rr}`,
    `Q${x + w},${y + h} ${x + w - rr},${y + h}`,
    `H${x}`,
    'Z',
  ].join(' ')
}

/**
 * Escala "bonita" para el eje Y: 0 y pasos redondos, y el ultimo paso
 * siempre por encima del maximo (si no, las barras se saldrian del marco).
 */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1]
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = 0; v <= top + step * 0.001; v += step) ticks.push(Math.round(v * 1e6) / 1e6)
  if (ticks.length < 2) ticks.push(step)
  return ticks
}

const GRID = 'var(--grid)'
const AXIS = 'var(--axis)'
const MUTED = 'var(--text-muted)'

/* ------------------------------------------------------------------ *
 * Columnas apiladas (o una sola serie si solo hay una)
 * ------------------------------------------------------------------ */

export interface StackDatum {
  key: string
  axisLabel: string
  fullLabel: string
  values: Record<string, number>
  /** linea de referencia opcional (limite del mes) */
  reference?: number
}

export function StackedColumns({
  data,
  series,
  height = 220,
  fmtValue,
  fmtTick,
  referenceLabel,
  title,
}: {
  data: StackDatum[]
  series: Series[]
  height?: number
  fmtValue: (n: number) => string
  fmtTick: (n: number) => string
  referenceLabel?: string
  title: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)

  const totals = data.map((d) => series.reduce((a, s) => a + (d.values[s.key] ?? 0), 0))
  const refMax = Math.max(0, ...data.map((d) => d.reference ?? 0))
  const max = Math.max(1, ...totals, refMax)
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1]

  const padL = 44
  const padR = 8
  const padT = 8
  const axisH = 22
  const plotW = Math.max(0, width - padL - padR)
  const plotH = height - padT - axisH
  const band = data.length ? plotW / data.length : plotW
  const barW = Math.min(24, Math.max(6, band - 10))
  const y = (v: number) => padT + plotH - (v / top) * plotH

  // en movil no caben todas las etiquetas del eje
  const labelEvery = band < 28 ? Math.ceil(28 / band) : 1

  return (
    <div ref={ref} className="relative w-full">
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${title}. ${data.length} puntos.`}
          className="block overflow-visible"
        >
          {ticks.map((tv) => (
            <g key={tv}>
              <line x1={padL} x2={padL + plotW} y1={y(tv)} y2={y(tv)} stroke={GRID} strokeWidth="1" />
              <text
                x={padL - 6}
                y={y(tv) + 3}
                textAnchor="end"
                fontSize="10"
                fill={MUTED}
                className="tabular-nums"
              >
                {fmtTick(tv)}
              </text>
            </g>
          ))}
          <line x1={padL} x2={padL + plotW} y1={y(0)} y2={y(0)} stroke={AXIS} strokeWidth="1" />

          {data.map((d, i) => {
            const x = padL + i * band + (band - barW) / 2
            let acc = 0
            const segs: { s: Series; bottom: number; topEdge: number }[] = []
            for (const s of series) {
              const v = d.values[s.key] ?? 0
              if (v <= 0) continue
              const bottom = y(acc)
              acc += v
              segs.push({ s, bottom, topEdge: y(acc) })
            }

            return (
              <g key={d.key}>
                {segs.map((seg, si) => {
                  const isTop = si === segs.length - 1
                  // hueco de 2px en color superficie entre segmentos apilados
                  const yTop = seg.topEdge + (isTop ? 0 : 2)
                  const h = Math.max(0.75, seg.bottom - yTop)
                  return (
                    <path
                      key={seg.s.key}
                      d={
                        isTop
                          ? barPathUp(x, yTop, barW, h)
                          : `M${x},${yTop} h${barW} v${h} h${-barW} Z`
                      }
                      fill={seg.s.color}
                      opacity={hover === null || hover === i ? 1 : 0.5}
                    />
                  )
                })}
                {d.reference !== undefined && d.reference > 0 && (
                  <line
                    x1={padL + i * band + 1}
                    x2={padL + (i + 1) * band - 1}
                    y1={y(d.reference)}
                    y2={y(d.reference)}
                    stroke={AXIS}
                    strokeWidth="1"
                  />
                )}
                {i % labelEvery === 0 && (
                  <text
                    x={padL + i * band + band / 2}
                    y={height - 6}
                    textAnchor="middle"
                    fontSize="10"
                    fill={MUTED}
                  >
                    {d.axisLabel}
                  </text>
                )}
                <rect
                  x={padL + i * band}
                  y={padT}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  onPointerEnter={() => setHover(i)}
                  onPointerMove={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  tabIndex={0}
                  role="button"
                  aria-label={`${d.fullLabel}: ${fmtValue(totals[i])}`}
                />
              </g>
            )
          })}

          {/* valor del ultimo mes, etiquetado directamente */}
          {data.length > 0 && totals[data.length - 1] > 0 && (
            <text
              x={padL + (data.length - 1) * band + band / 2}
              y={y(totals[data.length - 1]) - 6}
              textAnchor="middle"
              fontSize="10"
              fontWeight="600"
              fill="var(--text-secondary)"
            >
              {fmtTick(totals[data.length - 1])}
            </text>
          )}
        </svg>
      )}

      {hover !== null && data[hover] && (
        <Tooltip x={padL + hover * band + band / 2} y={8} width={width}>
          <div className="mb-1 font-semibold text-ink">{data[hover].fullLabel}</div>
          <TooltipRow label="Total" value={fmtValue(totals[hover])} strong />
          {series
            .filter((s) => (data[hover].values[s.key] ?? 0) > 0)
            .map((s) => (
              <TooltipRow
                key={s.key}
                color={s.color}
                label={s.label}
                value={fmtValue(data[hover].values[s.key] ?? 0)}
              />
            ))}
          {data[hover].reference !== undefined && (
            <TooltipRow label={referenceLabel ?? 'Limite'} value={fmtValue(data[hover].reference!)} />
          )}
        </Tooltip>
      )}
      <Legend series={series} />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Barras horizontales (rankings)
 * ------------------------------------------------------------------ */

export function HBars({
  data,
  height,
  fmtValue,
  title,
}: {
  data: { key: string; label: string; value: number; color: string; sub?: string }[]
  height?: number
  fmtValue: (n: number) => string
  title: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const rowH = 26
  const h = height ?? data.length * rowH + 4
  const max = Math.max(1, ...data.map((d) => d.value))
  const labelW = Math.min(120, Math.max(64, width * 0.32))
  const valueW = 74
  const plotW = Math.max(8, width - labelW - valueW)

  return (
    <div ref={ref} className="relative w-full">
      {width > 0 && (
        <svg width={width} height={h} role="img" aria-label={title} className="block">
          {data.map((d, i) => {
            const bw = Math.max(2, (d.value / max) * plotW)
            const y = i * rowH + 4
            const barH = Math.min(16, rowH - 10)
            return (
              <g
                key={d.key}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
              >
                <rect x={0} y={y - 4} width={width} height={rowH} fill="transparent" />
                <text x={0} y={y + barH / 2 + 4} fontSize="11" fill="var(--text-secondary)">
                  {d.label.length > 18 ? `${d.label.slice(0, 17)}…` : d.label}
                </text>
                <path
                  d={barPathRight(labelW, y, bw, barH)}
                  fill={d.color}
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
                <text
                  x={labelW + bw + 6}
                  y={y + barH / 2 + 4}
                  fontSize="11"
                  fill="var(--text-secondary)"
                  className="tabular-nums"
                >
                  {fmtValue(d.value)}
                </text>
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Donut (reparto del mes)
 * ------------------------------------------------------------------ */

export function Donut({
  data,
  size = 176,
  centerLabel,
  centerValue,
  fmtValue,
  title,
}: {
  data: { key: string; label: string; value: number; color: string }[]
  size?: number
  centerLabel: string
  centerValue: string
  fmtValue: (n: number) => string
  title: string
}) {
  const [hover, setHover] = useState<string | null>(null)
  const total = data.reduce((a, d) => a + d.value, 0)
  const stroke = 22
  const r = (size - stroke) / 2
  const c = size / 2
  const circ = 2 * Math.PI * r
  // hueco de 2px en color superficie entre segmentos
  const gap = total > 0 && data.length > 1 ? 2 : 0

  let offset = 0
  const arcs = data.map((d) => {
    const frac = total > 0 ? d.value / total : 0
    const len = Math.max(0, frac * circ - gap)
    const arc = { ...d, len, offset }
    offset += frac * circ
    return arc
  })

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-5">
      <svg width={size} height={size} role="img" aria-label={title} className="shrink-0">
        <g transform={`rotate(-90 ${c} ${c})`}>
          <circle cx={c} cy={c} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={stroke} />
          {arcs.map((a) => (
            <circle
              key={a.key}
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke={a.color}
              strokeWidth={hover === a.key ? stroke + 3 : stroke}
              strokeDasharray={`${a.len} ${circ - a.len}`}
              strokeDashoffset={-a.offset}
              onPointerEnter={() => setHover(a.key)}
              onPointerLeave={() => setHover(null)}
              style={{ transition: 'stroke-width 80ms linear' }}
            />
          ))}
        </g>
        <text
          x={c}
          y={c - 2}
          textAnchor="middle"
          fontSize="18"
          fontWeight="600"
          fill="var(--text-primary)"
        >
          {centerValue}
        </text>
        <text x={c} y={c + 14} textAnchor="middle" fontSize="10" fill={MUTED}>
          {centerLabel}
        </text>
      </svg>

      {/* leyenda con el valor al lado: el donut nunca es la unica via de lectura */}
      <ul className="w-full min-w-0 space-y-1">
        {data.map((d) => (
          <li
            key={d.key}
            className="flex items-baseline justify-between gap-2 text-xs"
            onPointerEnter={() => setHover(d.key)}
            onPointerLeave={() => setHover(null)}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                style={{ background: d.color }}
              />
              <span className="truncate text-ink-2">{d.label}</span>
            </span>
            <span className="shrink-0 tabular-nums text-ink">
              {fmtValue(d.value)}
              <span className="ml-1.5 text-muted">
                {total > 0 ? `${Math.round((d.value / total) * 100)}%` : ''}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Lineas (ritmo del mes, patrimonio, media diaria)
 * ------------------------------------------------------------------ */

export interface LinePoint {
  x: number
  label: string
  values: Record<string, number | null>
}

export function Lines({
  data,
  series,
  height = 200,
  fmtValue,
  fmtTick,
  fmtX,
  title,
  area,
}: {
  data: LinePoint[]
  series: Series[]
  height?: number
  fmtValue: (n: number) => string
  fmtTick: (n: number) => string
  fmtX: (x: number, label: string) => string
  title: string
  /** rellena bajo la primera serie con un lavado del 10% */
  area?: boolean
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)

  const all = data.flatMap((d) => series.map((s) => d.values[s.key]).filter((v): v is number => v !== null))
  const max = Math.max(1, ...all)
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1]

  const padL = 44
  const padR = 12
  const padT = 10
  const axisH = 22
  const plotW = Math.max(0, width - padL - padR)
  const plotH = height - padT - axisH
  const n = data.length
  const xOf = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const yOf = (v: number) => padT + plotH - (v / top) * plotH

  const paths = useMemo(
    () =>
      series.map((s) => {
        let d = ''
        let open = false
        data.forEach((p, i) => {
          const v = p.values[s.key]
          if (v === null || v === undefined) {
            open = false
            return
          }
          d += `${open ? 'L' : 'M'}${xOf(i)},${yOf(v)} `
          open = true
        })
        return { s, d }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, series, width, height, top],
  )

  const onMove = useCallback(
    (e: React.PointerEvent<SVGRectElement>) => {
      const rect = (e.target as SVGRectElement).getBoundingClientRect()
      const rel = e.clientX - rect.left
      const i = n <= 1 ? 0 : Math.round((rel / Math.max(1, plotW)) * (n - 1))
      setHover(Math.max(0, Math.min(n - 1, i)))
    },
    [n, plotW],
  )

  const labelEvery = n > 1 ? Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 46)))) : 1

  return (
    <div ref={ref} className="relative w-full">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={title} className="block overflow-visible">
          {ticks.map((tv) => (
            <g key={tv}>
              <line x1={padL} x2={padL + plotW} y1={yOf(tv)} y2={yOf(tv)} stroke={GRID} />
              <text x={padL - 6} y={yOf(tv) + 3} textAnchor="end" fontSize="10" fill={MUTED} className="tabular-nums">
                {fmtTick(tv)}
              </text>
            </g>
          ))}
          <line x1={padL} x2={padL + plotW} y1={yOf(0)} y2={yOf(0)} stroke={AXIS} />

          {area && paths[0]?.d && (
            <path
              d={`${paths[0].d} L${xOf(n - 1)},${yOf(0)} L${xOf(0)},${yOf(0)} Z`}
              fill={series[0].color}
              opacity="0.1"
            />
          )}
          {paths.map(({ s, d }) => (
            <path
              key={s.key}
              d={d}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={s.key.endsWith(':pace') ? '4 4' : undefined}
            />
          ))}

          {data.map((p, i) =>
            // el ultimo siempre; el resto solo si no choca con el ultimo
            i === n - 1 || (i % labelEvery === 0 && n - 1 - i >= labelEvery) ? (
              <text
                key={p.label + i}
                x={xOf(i)}
                y={height - 6}
                textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                fontSize="10"
                fill={MUTED}
              >
                {fmtX(p.x, p.label)}
              </text>
            ) : null,
          )}

          {hover !== null && (
            <>
              <line
                x1={xOf(hover)}
                x2={xOf(hover)}
                y1={padT}
                y2={padT + plotH}
                stroke={AXIS}
                strokeWidth="1"
              />
              {series.map((s) => {
                const v = data[hover]?.values[s.key]
                if (v === null || v === undefined) return null
                return (
                  <circle
                    key={s.key}
                    cx={xOf(hover)}
                    cy={yOf(v)}
                    r="4.5"
                    fill={s.color}
                    stroke="var(--surface-1)"
                    strokeWidth="2"
                  />
                )
              })}
            </>
          )}

          {/* punto final siempre visible: ancla la lectura */}
          {n > 0 &&
            series.map((s) => {
              const v = data[n - 1]?.values[s.key]
              if (v === null || v === undefined) return null
              return (
                <circle
                  key={`end-${s.key}`}
                  cx={xOf(n - 1)}
                  cy={yOf(v)}
                  r="4"
                  fill={s.color}
                  stroke="var(--surface-1)"
                  strokeWidth="2"
                />
              )
            })}

          <rect
            x={padL}
            y={padT}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}

      {hover !== null && data[hover] && (
        <Tooltip x={xOf(hover)} y={8} width={width}>
          <div className="mb-1 font-semibold text-ink">{data[hover].label}</div>
          {series.map((s) => {
            const v = data[hover].values[s.key]
            if (v === null || v === undefined) return null
            return <TooltipRow key={s.key} color={s.color} label={s.label} value={fmtValue(v)} strong />
          })}
        </Tooltip>
      )}
      <Legend series={series} />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Sparkline para las tarjetas
 * ------------------------------------------------------------------ */

export function Sparkline({
  values,
  width = 96,
  height = 24,
  color = 'var(--series-1)',
}: {
  values: number[]
  width?: number
  height?: number
  color?: string
}) {
  if (values.length < 2) return null
  const max = Math.max(...values)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const d = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (width - 2) + 1
      const y = height - 2 - ((v - min) / span) * (height - 4)
      return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const lastX = width - 1
  const lastY = height - 2 - ((values[values.length - 1] - min) / span) * (height - 4)
  return (
    <svg width={width} height={height} aria-hidden="true" className="mt-2 block">
      <path d={d} fill="none" stroke={AXIS} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="2.5" fill={color} />
    </svg>
  )
}

/* ------------------------------------------------------------------ *
 * Vista de tabla: el gemelo accesible de cada grafico
 * ------------------------------------------------------------------ */

export function DataTable({
  columns,
  rows,
  caption,
}: {
  columns: string[]
  rows: (string | number)[][]
  caption?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? rows : rows.slice(0, 12)
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-hairline">
            {columns.map((c, i) => (
              <th
                key={c}
                scope="col"
                className={`py-1.5 font-medium text-muted ${i === 0 ? 'text-left' : 'text-right'}`}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((r, ri) => (
            <tr key={ri} className="border-b border-hairline/60 last:border-0">
              {r.map((cell, ci) => (
                <td
                  key={ci}
                  className={`py-1.5 ${ci === 0 ? 'text-left text-ink-2' : 'text-right tabular-nums text-ink'}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 12 && (
        <button
          type="button"
          className="mt-2 text-xs text-[var(--series-1)] hover:underline"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? '−' : `+ ${rows.length - 12}`}
        </button>
      )}
    </div>
  )
}

/** Mantiene el render anterior atenuado mientras cambian los datos. */
export function useDeferredFade(dep: unknown): boolean {
  const [stale, setStale] = useState(false)
  useEffect(() => {
    setStale(true)
    const id = setTimeout(() => setStale(false), 60)
    return () => clearTimeout(id)
  }, [dep])
  return stale
}
