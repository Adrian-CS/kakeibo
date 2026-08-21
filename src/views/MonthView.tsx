import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import {
  activeCategories,
  categoryLimitsJpy,
  daysInMonth,
  getMonth,
  monthTotals,
  projectMonth,
  recentActiveAverageJpy,
  shiftMonth,
} from '../lib/calc'
import { fmtJpy, fmtMoney, fmtMonth, fmtPercent, parseAmount } from '../lib/format'
import { fetchFxRate } from '../lib/fx'
import { limitStatus, seriesVar, STATUS } from '../lib/palette'
import type { Expense, ExpenseKind, MonthData } from '../lib/types'
import {
  Button,
  Card,
  ConfirmButton,
  Field,
  Icon,
  IconButton,
  Meter,
  Modal,
  NumberInput,
  Select,
  StatTile,
  TextInput,
} from '../components/ui'
import { monthIdOf } from '../lib/defaults'
import { uid } from '../lib/id'

/* ------------------------------------------------------------------ *
 * Fila editable de gasto
 * ------------------------------------------------------------------ */

function ExpenseRow({ expense }: { expense: Expense }) {
  const { dispatch, data, t } = useStore()
  const [label, setLabel] = useState(expense.label)
  const [amount, setAmount] = useState(String(expense.amount))
  const [open, setOpen] = useState(false)

  useEffect(() => setLabel(expense.label), [expense.label])
  useEffect(() => setAmount(String(expense.amount)), [expense.amount])

  const commitLabel = () => {
    const v = label.trim()
    if (v !== expense.label) dispatch({ type: 'patchExpense', id: expense.id, patch: { label: v } })
  }
  const commitAmount = () => {
    const n = parseAmount(amount)
    if (n === null) {
      setAmount(String(expense.amount))
      return
    }
    if (n !== expense.amount) dispatch({ type: 'patchExpense', id: expense.id, patch: { amount: n } })
  }

  const lang = data.settings.lang
  const kindMark =
    expense.kind === 'recurring'
      ? '↻'
      : expense.kind === 'extraordinary'
        ? '★'
        : expense.kind === 'noCost'
          ? '🎁'
          : null
  const kindTitle =
    expense.kind === 'recurring'
      ? t('kind.recurring')
      : expense.kind === 'extraordinary'
        ? t('kind.extraordinary')
        : expense.kind === 'noCost'
          ? `${t('kind.noCost')} — ${t('kind.noCost.hint')}`
          : undefined

  return (
    <li className="group flex items-center gap-1.5 py-0.5">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={commitLabel}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        placeholder={t('fields.label')}
        aria-label={t('fields.label')}
        className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1.5 text-sm text-ink placeholder:text-muted hover:bg-surface-2 focus:bg-surface-2"
      />
      {kindMark && (
        <span className="shrink-0 text-[11px] text-muted" title={kindTitle}>
          {kindMark}
        </span>
      )}
      <input
        value={amount}
        inputMode="decimal"
        onChange={(e) => setAmount(e.target.value)}
        onBlur={commitAmount}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        aria-label={t('fields.amount')}
        className="w-[86px] shrink-0 rounded-md bg-transparent px-1.5 py-1.5 text-right text-sm tabular-nums text-ink hover:bg-surface-2 focus:bg-surface-2"
      />
      <IconButton label={t('action.edit')} onClick={() => setOpen(true)} className="h-8 w-8 shrink-0">
        <Icon name="edit" />
      </IconButton>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={expense.label || t('fields.label')}
        footer={
          <>
            <ConfirmButton
              size="md"
              confirmLabel={`${t('action.delete')}?`}
              onConfirm={() => {
                dispatch({ type: 'deleteExpense', id: expense.id })
                setOpen(false)
              }}
            >
              {t('action.delete')}
            </ConfirmButton>
            <Button variant="primary" size="md" onClick={() => setOpen(false)}>
              {t('action.close')}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('fields.category')} className="col-span-2">
            <Select
              value={expense.categoryId}
              onChange={(v) => dispatch({ type: 'patchExpense', id: expense.id, patch: { categoryId: v } })}
              options={activeCategories(data.categories).map((c) => ({ value: c.id, label: c.name }))}
            />
          </Field>
          <Field
            label={t('fields.kind')}
            hint={expense.kind === 'noCost' ? t('kind.noCost.hint') : undefined}
          >
            <Select
              value={expense.kind}
              onChange={(v) =>
                dispatch({ type: 'patchExpense', id: expense.id, patch: { kind: v as ExpenseKind } })
              }
              options={[
                { value: 'normal', label: t('kind.normal') },
                { value: 'recurring', label: t('kind.recurring') },
                { value: 'extraordinary', label: t('kind.extraordinary') },
                { value: 'noCost', label: t('kind.noCost') },
              ]}
            />
          </Field>
          <Field label={`${t('fields.day')} (${t('common.optional')})`}>
            <NumberInput
              value={expense.day ?? ''}
              placeholder="—"
              onChange={(e) => {
                const n = parseAmount(e.target.value)
                dispatch({
                  type: 'patchExpense',
                  id: expense.id,
                  patch: { day: n === null ? null : Math.max(1, Math.min(31, Math.round(n))) },
                })
              }}
            />
          </Field>
          <Field label={t('fields.note')} className="col-span-2">
            <TextInput
              value={expense.note ?? ''}
              onChange={(e) => dispatch({ type: 'patchExpense', id: expense.id, patch: { note: e.target.value } })}
            />
          </Field>
        </div>
        <p className="mt-3 text-xs text-muted">
          {t('kind.recurring')}: {t('kind.recurring.hint')} · {t('kind.extraordinary')}:{' '}
          {t('kind.extraordinary.hint')} · {t('kind.noCost')}: {t('kind.noCost.hint')}
        </p>
        <p className="mt-1 text-xs text-muted">
          {fmtJpy(expense.amount, lang)} ·{' '}
          {fmtMoney(
            expense.amount * (getMonth(data, expense.monthId)?.fxRate ?? data.settings.defaultFxRate),
            data.settings.secondaryCurrency,
            lang,
          )}
        </p>
      </Modal>
    </li>
  )
}

/* ------------------------------------------------------------------ *
 * Fila para anadir
 * ------------------------------------------------------------------ */

function AddRow({ monthId, categoryId }: { monthId: string; categoryId: string }) {
  const { dispatch, t } = useStore()
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const labelRef = useRef<HTMLInputElement>(null)

  const submit = () => {
    const n = parseAmount(amount)
    if (n === null || n === 0) return
    dispatch({
      type: 'addExpense',
      expense: { monthId, categoryId, label: label.trim(), amount: n, kind: 'normal' },
    })
    setLabel('')
    setAmount('')
    labelRef.current?.focus()
  }

  return (
    <li className="flex items-center gap-1.5 border-t border-hairline pt-1.5">
      <input
        ref={labelRef}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder={t('fields.label')}
        aria-label={t('fields.label')}
        className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1.5 text-sm text-ink placeholder:text-muted focus:bg-surface-2"
      />
      <input
        value={amount}
        inputMode="decimal"
        onChange={(e) => setAmount(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="0"
        aria-label={t('fields.amount')}
        className="w-[86px] shrink-0 rounded-md bg-transparent px-1.5 py-1.5 text-right text-sm tabular-nums text-ink placeholder:text-muted focus:bg-surface-2"
      />
      <IconButton label={t('action.add')} onClick={submit} className="h-8 w-8 shrink-0">
        <Icon name="plus" />
      </IconButton>
    </li>
  )
}

/* ------------------------------------------------------------------ *
 * Alta rapida (boton flotante en movil)
 * ------------------------------------------------------------------ */

function QuickAdd({ monthId }: { monthId: string }) {
  const { data, dispatch, t } = useStore()
  const [open, setOpen] = useState(false)
  const cats = activeCategories(data.categories)
  const [categoryId, setCategoryId] = useState(cats[0]?.id ?? '')
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [kind, setKind] = useState<ExpenseKind>('normal')
  const [day, setDay] = useState('')

  const submit = (keepOpen: boolean) => {
    const n = parseAmount(amount)
    if (n === null || n === 0 || !categoryId) return
    const d = parseAmount(day)
    dispatch({
      type: 'addExpense',
      expense: {
        monthId,
        categoryId,
        label: label.trim(),
        amount: n,
        kind,
        day: d === null ? null : Math.max(1, Math.min(31, Math.round(d))),
      },
    })
    setLabel('')
    setAmount('')
    if (!keepOpen) setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('action.quickAdd')}
        className="no-print fixed right-4 bottom-[4.6rem] z-30 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--series-1)] text-white shadow-lg sm:hidden"
      >
        <Icon name="plus" size={22} />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('action.quickAdd')}
        footer={
          <>
            <Button size="md" onClick={() => submit(true)}>
              {t('action.add')} +
            </Button>
            <Button size="md" variant="primary" onClick={() => submit(false)}>
              {t('action.save')}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('fields.category')} className="col-span-2">
            <Select
              value={categoryId}
              onChange={setCategoryId}
              options={cats.map((c) => ({ value: c.id, label: c.name }))}
            />
          </Field>
          <Field label={t('fields.label')} className="col-span-2">
            <TextInput value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
          </Field>
          <Field label={t('fields.amount')}>
            <NumberInput
              value={amount}
              placeholder="0"
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit(false)}
            />
          </Field>
          <Field label={`${t('fields.day')} (${t('common.optional')})`}>
            <NumberInput value={day} placeholder="—" onChange={(e) => setDay(e.target.value)} />
          </Field>
          <Field
            label={t('fields.kind')}
            className="col-span-2"
            hint={kind === 'noCost' ? t('kind.noCost.hint') : undefined}
          >
            <Select
              value={kind}
              onChange={(v) => setKind(v as ExpenseKind)}
              options={[
                { value: 'normal', label: t('kind.normal') },
                { value: 'recurring', label: t('kind.recurring') },
                { value: 'extraordinary', label: t('kind.extraordinary') },
                { value: 'noCost', label: t('kind.noCost') },
              ]}
            />
          </Field>
        </div>
      </Modal>
    </>
  )
}

/* ------------------------------------------------------------------ *
 * Vista
 * ------------------------------------------------------------------ */

export function MonthView({
  monthId,
  setMonthId,
}: {
  monthId: string
  setMonthId: (id: string) => void
}) {
  const { data, dispatch, t, canUndo } = useStore()
  const lang = data.settings.lang
  const cur = data.settings.secondaryCurrency
  const month = getMonth(data, monthId)
  const totals = useMemo(() => monthTotals(data, monthId), [data, monthId])
  const cats = activeCategories(data.categories)
  const status = STATUS[limitStatus(totals.usedRatio)]
  const projection = projectMonth(data, monthId)
  const isCurrent = monthId === monthIdOf()
  // media reciente, para el "segun tu ritmo habitual" del ahorro previsto
  const recentAverageJpy = useMemo(() => recentActiveAverageJpy(data, 6), [data])
  const savingsWorstCaseJpy = totals.incomeJpy - totals.limitJpy
  // otro "peor caso", mas fino: el tope de cada categoria (0 en las que no
  // tienen), mas alquiler y extras del mes
  const savingsByCategoryLimitsJpy =
    totals.incomeJpy - (categoryLimitsJpy(data.categories) + totals.rentJpy + totals.extrasJpy)
  const savingsRealisticJpy = totals.incomeJpy - recentAverageJpy

  const eur = (jpy: number) => fmtMoney(jpy * totals.fxRate, cur, lang)
  const [fxBusy, setFxBusy] = useState(false)

  const patch = (p: Partial<MonthData>) => dispatch({ type: 'patchMonth', monthId, patch: p })

  return (
    <div className="space-y-3">
      {/* navegacion */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <IconButton label={t('month.prev')} onClick={() => setMonthId(shiftMonth(monthId, -1))}>
            <Icon name="left" />
          </IconButton>
          <h1 className="min-w-[8.5rem] text-center text-base font-semibold text-ink">
            {fmtMonth(monthId, lang, true)}
          </h1>
          <IconButton label={t('month.next')} onClick={() => setMonthId(shiftMonth(monthId, 1))}>
            <Icon name="right" />
          </IconButton>
        </div>
        <div className="flex items-center gap-1">
          {!isCurrent && (
            <Button size="sm" onClick={() => setMonthId(monthIdOf())}>
              {t('month.today')}
            </Button>
          )}
          {canUndo && (
            <IconButton label={t('action.undo')} onClick={() => dispatch({ type: 'undo' })}>
              <Icon name="undo" />
            </IconButton>
          )}
        </div>
      </div>

      {/* resumen */}
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs text-ink-2">{t('totals.total')}</p>
            <p className="text-4xl leading-none font-semibold text-ink">{fmtJpy(totals.totalJpy, lang)}</p>
            <p className="mt-1 text-sm text-muted">{eur(totals.totalJpy)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-ink-2">
              {totals.balanceJpy >= 0 ? t('totals.balance') : t('totals.over')}
            </p>
            <p
              className="text-xl font-semibold tabular-nums"
              style={{ color: totals.balanceJpy >= 0 ? 'var(--text-primary)' : 'var(--critical)' }}
            >
              {fmtJpy(Math.abs(totals.balanceJpy), lang)}
            </p>
            <p className="text-xs text-muted">
              {fmtPercent(totals.usedRatio, lang)} {t('totals.used')}
            </p>
          </div>
        </div>
        <div className="mt-3">
          <Meter ratio={totals.usedRatio} color={status} label={t('totals.limit')} />
        </div>
      </Card>

      {/* indicadores */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile
          label={t('totals.daily')}
          value={fmtJpy(totals.dailyLifeJpy, lang)}
          secondary={eur(totals.dailyLifeJpy)}
          hint={t('totals.dailyHint')}
        />
        <StatTile
          label={t('totals.fixed')}
          value={fmtJpy(totals.fixedJpy, lang)}
          secondary={eur(totals.fixedJpy)}
          hint={t('totals.fixedHint')}
        />
        <StatTile
          label={t('totals.other')}
          value={fmtJpy(totals.otherJpy, lang)}
          secondary={eur(totals.otherJpy)}
          hint={t('totals.otherHint')}
        />
        <StatTile
          label={isCurrent ? t('totals.projection') : t('totals.perDay')}
          value={fmtJpy(isCurrent ? projection : totals.perDayJpy, lang)}
          secondary={
            isCurrent
              ? `${t('totals.perDay')}: ${fmtJpy(
                  totals.totalJpy / Math.min(new Date().getDate(), daysInMonth(monthId)),
                  lang,
                )}`
              : eur(totals.perDayJpy)
          }
        />
      </div>

      {totals.incomeJpy > 0 && (
        <Card title={t('totals.savingsForecast')} hint={t('totals.savingsForecastHint')}>
          <div className="grid grid-cols-3 gap-2">
            <StatTile
              label={t('totals.savingsWorstLimit')}
              value={fmtJpy(savingsWorstCaseJpy, lang)}
            />
            <StatTile
              label={t('totals.savingsWorstCategoryLimits')}
              value={fmtJpy(savingsByCategoryLimitsJpy, lang)}
              hint={t('totals.savingsWorstCategoryLimitsHint')}
            />
            <StatTile label={t('totals.savingsRealistic')} value={fmtJpy(savingsRealisticJpy, lang)} />
          </div>
        </Card>
      )}

      {/* categorias */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cats.map((c) => {
          const items = data.expenses.filter((e) => e.monthId === monthId && e.categoryId === c.id)
          const subtotal = totals.byCategory[c.id] ?? 0
          return (
            <Card
              key={c.id}
              title={
                <span className="flex items-center gap-2 normal-case">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 rounded-[2px]"
                    style={{ background: seriesVar(c.colorSlot) }}
                  />
                  <span className="text-sm font-semibold">{c.name}</span>
                </span>
              }
              hint={c.nameJa && lang !== 'ja' ? c.nameJa : undefined}
              actions={
                <div className="text-right">
                  <div className="text-sm font-semibold tabular-nums text-ink">
                    {fmtJpy(subtotal, lang)}
                  </div>
                  <div className="text-[11px] text-muted tabular-nums">{eur(subtotal)}</div>
                </div>
              }
            >
              {!!c.limitJpy && c.limitJpy > 0 && (
                <div className="mb-2">
                  <Meter
                    ratio={subtotal / c.limitJpy}
                    color={STATUS[limitStatus(subtotal / c.limitJpy)]}
                    label={`${t('cat.limit')}: ${c.name}`}
                  />
                  <p className="mt-1 text-[11px] text-muted">
                    {subtotal > c.limitJpy
                      ? `${fmtJpy(subtotal - c.limitJpy, lang)} ${t('cat.over')}`
                      : `${fmtJpy(c.limitJpy - subtotal, lang)} ${t('cat.left')}`}{' '}
                    ({fmtJpy(c.limitJpy, lang)})
                  </p>
                </div>
              )}
              <ul className="space-y-0">
                {items.map((e) => (
                  <ExpenseRow key={e.id} expense={e} />
                ))}
                <AddRow monthId={monthId} categoryId={c.id} />
              </ul>
            </Card>
          )
        })}
      </div>

      {/* fijos y parametros del mes */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card title={t('totals.fixed')} hint={t('totals.fixedHint')}>
          <div className="space-y-3">
            <Field label={t('fields.rent')}>
              <NumberInput
                value={month?.rentJpy ?? 0}
                onChange={(e) => {
                  const n = parseAmount(e.target.value)
                  if (n !== null) patch({ rentJpy: n })
                }}
              />
            </Field>

            <div>
              <p className="mb-1 text-xs font-medium text-ink-2">{t('fields.extras')}</p>
              <ul className="space-y-1">
                {(month?.extras ?? []).map((x) => (
                  <li key={x.id} className="flex items-center gap-1.5">
                    <TextInput
                      value={x.label}
                      onChange={(e) =>
                        dispatch({
                          type: 'patchExtra',
                          monthId,
                          id: x.id,
                          patch: { label: e.target.value },
                        })
                      }
                      className="flex-1"
                    />
                    <NumberInput
                      value={x.amount}
                      onChange={(e) => {
                        const n = parseAmount(e.target.value)
                        if (n !== null)
                          dispatch({ type: 'patchExtra', monthId, id: x.id, patch: { amount: n } })
                      }}
                      className="w-[92px] shrink-0"
                    />
                    <IconButton
                      label={t('action.delete')}
                      onClick={() => dispatch({ type: 'deleteExtra', monthId, id: x.id })}
                      className="h-9 w-9 shrink-0"
                    >
                      <Icon name="trash" />
                    </IconButton>
                  </li>
                ))}
              </ul>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  onClick={() => dispatch({ type: 'addExtra', monthId, extra: { label: '', amount: 0 } })}
                >
                  <Icon name="plus" />
                  {t('action.add')}
                </Button>
                {data.settings.defaultExtras.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      patch({
                        extras: [
                          ...(month?.extras ?? []),
                          ...data.settings.defaultExtras.map((x) => ({ ...x, id: uid('x') })),
                        ],
                      })
                    }
                  >
                    {t('month.loadDefaultExtras')}
                  </Button>
                )}
              </div>
            </div>

            <p className="text-xs text-muted">
              {t('totals.fixed')}: <span className="tabular-nums text-ink-2">{fmtJpy(totals.fixedJpy, lang)}</span>
            </p>
          </div>
        </Card>

        <Card title={t('nav.settings')}>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('fields.limit')}>
              <NumberInput
                value={month?.limitJpy ?? 0}
                onChange={(e) => {
                  const n = parseAmount(e.target.value)
                  if (n !== null) patch({ limitJpy: n })
                }}
              />
            </Field>
            <Field label={t('fields.income')} hint={t('fields.incomeHint')}>
              <NumberInput
                value={month?.incomeJpy ?? 0}
                onChange={(e) => {
                  const n = parseAmount(e.target.value)
                  if (n !== null) patch({ incomeJpy: n })
                }}
              />
            </Field>
            <Field label={t('fields.fx')} hint={`1 ¥ = ${totals.fxRate} ${cur}`}>
              <div className="flex items-center gap-1.5">
                <NumberInput
                  value={month?.fxRate ?? 0}
                  onChange={(e) => {
                    const n = parseAmount(e.target.value)
                    if (n !== null) patch({ fxRate: n })
                  }}
                  className="w-full min-w-0"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  disabled={fxBusy}
                  onClick={() => {
                    setFxBusy(true)
                    void fetchFxRate(cur)
                      .then((r) => patch({ fxRate: r.rate }))
                      .catch(() => undefined)
                      .finally(() => setFxBusy(false))
                  }}
                >
                  {t('fx.update')}
                </Button>
              </div>
            </Field>
            <Field label={t('fields.note')} className="col-span-2">
              <TextInput
                value={month?.note ?? ''}
                placeholder="…"
                onChange={(e) => patch({ note: e.target.value })}
              />
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => dispatch({ type: 'copyFixed', from: shiftMonth(monthId, -1), to: monthId })}
            >
              {t('month.copyPrev')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => dispatch({ type: 'copyFixed', from: monthId, to: shiftMonth(monthId, 1) })}
            >
              {t('month.duplicate')}
            </Button>
          </div>
          {totals.extraordinaryJpy > 0 && (
            <p className="mt-3 text-xs text-muted">
              ★ {t('totals.extraordinary')}:{' '}
              <span className="tabular-nums text-ink-2">{fmtJpy(totals.extraordinaryJpy, lang)}</span>
            </p>
          )}
          {totals.noCostCount > 0 && (
            <p className="mt-1 text-xs text-muted" title={t('kind.noCost.hint')}>
              🎁 {t('totals.noCost')}: {totals.noCostCount} ·{' '}
              <span className="tabular-nums text-ink-2">{fmtJpy(totals.noCostJpy, lang)}</span>
            </p>
          )}
        </Card>
      </div>

      <QuickAdd monthId={monthId} />
    </div>
  )
}
