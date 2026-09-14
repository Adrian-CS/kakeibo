import { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import {
  activeCategories,
  categoryLabel,
  computeStats,
  computeYoy,
  datedCount,
  hasRealSpend,
  mergeSavingsRateSeries,
  monthBurn,
  monthTotals,
  noCostItems,
  projectMonth,
  quarterlyTicket,
  recurringItems,
  savingsRateSeries,
  shiftMonth,
  sum,
  topExpenses,
  topLabels,
} from '../lib/calc'
import {
  combinedCategories,
  combinedDatedCount,
  combinedMonthBurn,
  combinedMonthTotals,
  combinedNoCostItems,
  combinedStats,
  combinedTopExpenses,
  combinedTopLabels,
  combinedYoy,
} from '../lib/householdCalc'
import { emptyData, monthIdOf } from '../lib/defaults'
import { useHousehold, type HouseholdViewScope } from '../state/household'
import {
  fmtCompact,
  fmtJpy,
  fmtMoney,
  fmtMonth,
  fmtMonthAxis,
  fmtNumber,
  fmtPercent,
  fmtSignedPercent,
} from '../lib/format'
import { seriesVar } from '../lib/palette'
import type { AppData } from '../lib/types'
import { Card, Collapsible, Icon, IconButton, Segmented, Select, StatTile, Toggle } from '../components/ui'
import {
  Columns,
  DataTable,
  Donut,
  HBars,
  Lines,
  Sparkline,
  StackedColumns,
  type StackDatum,
} from '../components/charts'

type Range = '6' | '12' | '24' | 'all'
type BiggestScope = 'period' | 'month'

export function StatsView({
  monthId,
  setMonthId,
}: {
  monthId: string
  setMonthId: (id: string) => void
}) {
  const { data, t } = useStore()
  const household = useHousehold()
  const lang = data.settings.lang
  const cur = data.settings.secondaryCurrency

  const [range, setRange] = useState<Range>('12')
  const [excludeExtra, setExcludeExtra] = useState(false)
  const [tables, setTables] = useState(false)
  const [biggestScope, setBiggestScope] = useState<BiggestScope>('period')
  const [ticketLabel, setTicketLabel] = useState('')
  const [scope, setScope] = useState<HouseholdViewScope>('mine')

  const lastMonths = range === 'all' ? 0 : Number(range)
  const links = data.settings.householdCategoryLinks
  const isTogether = scope === 'together'
  const isPartner = scope === 'partner'
  // "Juntos" no tiene un unico AppData: usa los combinadores de
  // householdCalc.ts sobre los dos documentos. "Pareja" reutiliza tal cual
  // las mismas funciones de calc.ts que "Yo", solo que sobre el documento de
  // la pareja (de solo lectura, nunca se edita ni se guarda aqui).
  const source = isPartner ? (household.partnerData ?? emptyData()) : data
  const partnerMissing = isPartner && !household.partnerData

  const cats = isTogether
    ? combinedCategories(data.categories, household.partnerData?.categories ?? [], links)
    : activeCategories(source.categories)

  // el mes en foco: el que se elige aqui mismo (o el que ya estaba
  // seleccionado en Mes). "Reparto del mes", "Ritmo del mes" y el primer
  // indicador de arriba son siempre sobre este mes, tenga datos o no.
  const focusId = monthId
  const focusPrevId = shiftMonth(focusId, -1)
  const focus = isTogether
    ? combinedMonthTotals(data, household.partnerData, focusId, links)
    : monthTotals(source, focusId)
  const focusPrev = isTogether
    ? combinedMonthTotals(data, household.partnerData, focusPrevId, links)
    : monthTotals(source, focusPrevId)
  // el mes anterior solo cuenta como comparacion si tuvo gasto real: si no,
  // uno de solo alquiler/fijos (total > 0 pero sin nada del dia a dia)
  // dispararia un "+104% vs mes anterior" enganoso, comparando un mes de
  // verdad contra uno que no lo era
  const hasFocusPrev =
    (hasRealSpend(source, focusPrevId) ||
      (isTogether && !!household.partnerData && hasRealSpend(household.partnerData, focusPrevId))) &&
    focusPrev.totalJpy > 0
  const focusMomRatio = hasFocusPrev ? focus.totalJpy / focusPrev.totalJpy - 1 : 0

  const stats = useMemo(
    () =>
      isTogether
        ? combinedStats(data, household.partnerData, links, { lastMonths, excludeExtraordinary: excludeExtra })
        : computeStats(source, { lastMonths, excludeExtraordinary: excludeExtra }),
    [isTogether, data, household.partnerData, links, source, lastMonths, excludeExtra],
  )

  const monthIds = stats.months.map((m) => m.monthId)
  const labels = useMemo(
    () =>
      isTogether
        ? combinedTopLabels(data, household.partnerData, links, {
            limit: 10,
            monthIds,
            excludeExtraordinary: excludeExtra,
          })
        : topLabels(source, { limit: 10, monthIds, excludeExtraordinary: excludeExtra }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isTogether, data, household.partnerData, links, source, excludeExtra, monthIds.join(',')],
  )
  const biggestMonthIds = biggestScope === 'month' ? [focusId] : monthIds
  const biggest = useMemo(
    () =>
      isTogether
        ? combinedTopExpenses(data, household.partnerData, links, {
            limit: 8,
            monthIds: biggestMonthIds,
            excludeExtraordinary: excludeExtra,
          })
        : topExpenses(source, { limit: 8, monthIds: biggestMonthIds, excludeExtraordinary: excludeExtra }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isTogether, data, household.partnerData, links, source, excludeExtra, biggestMonthIds.join(',')],
  )
  const gifts = useMemo(
    () =>
      isTogether
        ? combinedNoCostItems(data, household.partnerData, links, { monthIds })
        : noCostItems(source, { monthIds }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isTogether, data, household.partnerData, links, source, monthIds.join(',')],
  )

  // los documentos que entran en las cifras: en "Juntos" el mio y el de mi
  // pareja, en el resto solo el que se esta mirando (mismo criterio que en
  // Ahorros)
  const sides = useMemo<AppData[]>(
    () =>
      isTogether ? [data, household.partnerData].filter((d): d is AppData => !!d) : [source],
    [isTogether, data, household.partnerData, source],
  )
  const currentId = monthIdOf()

  const rateSeries = useMemo(
    () => mergeSavingsRateSeries(sides.map((d) => savingsRateSeries(d, monthIds))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sides, monthIds.join(',')],
  )
  const hasIncome = rateSeries.some((p) => p.rate !== null)
  // `recurringItems` y `quarterlyTicket` solo leen `expenses`, asi que para
  // la vista combinada basta con juntar los apuntes de los dos
  const bothSides = useMemo(
    () => ({ ...source, expenses: sides.flatMap((d) => d.expenses) }),
    [source, sides],
  )
  const recurring = useMemo(
    () => recurringItems(bothSides, { monthIds }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bothSides, monthIds.join(',')],
  )
  const recurringYearlyJpy = sum(recurring.map((r) => r.yearlyJpy))
  // el comercio del ticket medio: el elegido si sigue en la lista, y si no
  // el que mas pesa del periodo
  const ticketPick = labels.some((l) => l.label === ticketLabel) ? ticketLabel : (labels[0]?.label ?? '')
  const ticket = useMemo(
    () => (ticketPick ? quarterlyTicket(bothSides, ticketPick, { monthIds }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bothSides, ticketPick, monthIds.join(',')],
  )

  const series = cats.map((c) => ({ key: c.id, label: categoryLabel(c, lang), color: seriesVar(c.colorSlot) }))
  const jpy = (n: number) => fmtJpy(n, lang)
  const compact = (n: number) => fmtCompact(n, lang)
  const catLabel = (id: string) => {
    const c = cats.find((c) => c.id === id)
    return c ? categoryLabel(c, lang) : id
  }

  if (partnerMissing) {
    return (
      <Card title={t('stats.title')}>
        <p className="text-sm text-muted">{t('household.noPartnerDataYet')}</p>
      </Card>
    )
  }

  if (stats.months.length === 0) {
    return (
      <Card title={t('stats.title')}>
        <p className="text-sm text-muted">{t('stats.noData')}</p>
      </Card>
    )
  }

  const stackData: StackDatum[] = stats.months.map((m) => ({
    key: m.monthId,
    axisLabel: fmtMonthAxis(m.monthId, lang),
    fullLabel: fmtMonth(m.monthId, lang, true),
    values: m.byCategory,
    reference: m.limitJpy || undefined,
    inProgress: m.monthId === currentId,
    projected:
      m.monthId === currentId
        ? sum(sides.map((d) => projectMonth(d, m.monthId)))
        : undefined,
  }))

  const donutData = cats
    .map((c) => ({
      key: c.id,
      label: categoryLabel(c, lang),
      value: focus.byCategory[c.id] ?? 0,
      color: seriesVar(c.colorSlot),
    }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
  if (focus.rentJpy + focus.extrasJpy > 0) {
    donutData.push({
      key: '__fixed',
      label: `${t('fields.rent')} + ${t('fields.extras')}`,
      value: focus.rentJpy + focus.extrasJpy,
      color: 'var(--axis)',
    })
  }

  const perDayPoints = stats.months.map((m, i) => ({
    x: i,
    label: fmtMonth(m.monthId, lang),
    values: { day: m.perDayJpy },
  }))

  const yoy = isTogether
    ? combinedYoy(data, household.partnerData, focusId, { excludeExtraordinary: excludeExtra })
    : computeYoy(source, focusId, { excludeExtraordinary: excludeExtra })
  const monthNames = Array.from({ length: 12 }, (_, i) =>
    fmtMonthAxis(`${yoy.year}-${String(i + 1).padStart(2, '0')}`, lang),
  )

  const burn = isTogether ? combinedMonthBurn(data, household.partnerData, focusId) : monthBurn(source, focusId)
  const hasDays = isTogether
    ? combinedDatedCount(data, household.partnerData, focusId) > 0
    : datedCount(source, focusId) > 0

  return (
    <div className="space-y-3">
      {/* mes en foco: el que se ve arriba, en "Reparto del mes", "Ritmo del
          mes" y en "Gastos mas grandes" si esta en modo "este mes" */}
      <div className="flex items-center gap-1">
        <IconButton label={t('month.prev')} onClick={() => setMonthId(shiftMonth(focusId, -1))}>
          <Icon name="left" />
        </IconButton>
        <h2 className="min-w-[8.5rem] text-center text-sm font-semibold text-ink">
          {fmtMonth(focusId, lang, true)}
        </h2>
        <IconButton label={t('month.next')} onClick={() => setMonthId(shiftMonth(focusId, 1))}>
          <Icon name="right" />
        </IconButton>
      </div>

      {/* una sola fila de filtros, encima de todo lo que afecta */}
      <div className="flex flex-wrap items-center gap-3">
        {household.partnerLink && (
          <Segmented<HouseholdViewScope>
            label={t('household.scope')}
            value={scope}
            onChange={setScope}
            options={[
              { id: 'mine', label: t('household.scope.mine') },
              { id: 'partner', label: t('household.scope.partner') },
              { id: 'together', label: t('household.scope.together') },
            ]}
          />
        )}
        <Segmented<Range>
          label={t('stats.range')}
          value={range}
          onChange={setRange}
          options={[
            { id: '6', label: `6 ${t('stats.months')}` },
            { id: '12', label: `12 ${t('stats.months')}` },
            { id: '24', label: `24 ${t('stats.months')}` },
            { id: 'all', label: t('stats.range.all') },
          ]}
        />
        <Toggle
          checked={excludeExtra}
          onChange={setExcludeExtra}
          label={t('stats.excludeExtraordinary')}
        />
        <Toggle checked={tables} onChange={setTables} label={t('stats.showTables')} />
      </div>

      {/* indicadores del periodo */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatTile
          label={`${t('totals.total')} · ${fmtMonth(focusId, lang)}`}
          value={jpy(focus.totalJpy)}
          secondary={fmtMoney(focus.totalJpy * focus.fxRate, cur, lang)}
          delta={hasFocusPrev ? `${fmtSignedPercent(focusMomRatio, lang)} ${t('stats.vsPrev')}` : undefined}
          deltaGood={focusMomRatio <= 0}
        >
          <Sparkline values={stats.months.map((m) => m.totalJpy)} />
        </StatTile>
        <StatTile
          label={t('stats.avgMonth')}
          value={jpy(stats.averageJpy)}
          secondary={`${t('stats.median')}: ${compact(stats.medianJpy)} ¥`}
          hint={
            stats.activeMonthCount === stats.months.length
              ? `${stats.months.length} ${t(stats.months.length === 1 ? 'stats.monthsOne' : 'stats.months')}`
              : t('stats.activeMonthsHint', { n: stats.activeMonthCount, total: stats.months.length })
          }
        />
        <StatTile
          label={t('stats.perDay')}
          value={jpy(stats.perDayJpy)}
          secondary={fmtMoney(stats.perDayJpy * (stats.months.at(-1)?.fxRate ?? 0), cur, lang)}
        />
        <StatTile
          label={t('stats.total')}
          value={`${compact(stats.totalJpy)} ¥`}
          secondary={fmtMoney(stats.totalJpy * (stats.months.at(-1)?.fxRate ?? 0), cur, lang)}
          hint={`${t('stats.max')}: ${
            stats.maxMonth ? fmtMonth(stats.maxMonth.monthId, lang) : '—'
          } · ${t('stats.min')}: ${stats.minMonth ? fmtMonth(stats.minMonth.monthId, lang) : '—'}`}
        />
      </div>

      {/* composicion mensual */}
      <Card title={t('stats.byCategoryMonth')} hint={t('stats.byMonthHint')}>
        <StackedColumns
          data={stackData}
          series={series}
          fmtValue={jpy}
          fmtTick={compact}
          referenceLabel={t('totals.limit')}
          projectionLabel={t('totals.projection')}
          title={t('stats.byCategoryMonth')}
        />
        {stackData.some((d) => d.inProgress) && (
          <p className="mt-2 text-[11px] text-muted">{t('stats.inProgressNote')}</p>
        )}
        {tables && (
          <DataTable
            caption={t('stats.byCategoryMonth')}
            columns={[
              t('common.month'),
              ...cats.map((c) => categoryLabel(c, lang)),
              t('totals.total'),
              t('totals.limit'),
            ]}
            rows={stats.months.map((m) => [
              fmtMonth(m.monthId, lang),
              ...cats.map((c) => fmtNumber(m.byCategory[c.id] ?? 0, lang)),
              fmtNumber(m.totalJpy, lang),
              fmtNumber(m.limitJpy, lang),
            ])}
          />
        )}
      </Card>

      {/* tasa de ahorro mes a mes */}
      <Collapsible
        id="stats.savingsRate"
        title={t('stats.savingsRate')}
        hint={t('stats.savingsRateHint')}
        summary={
          rateSeries.at(-1)?.rate == null
            ? t('common.none')
            : fmtPercent(rateSeries.at(-1)!.rate!, lang)
        }
      >
        {hasIncome ? (
          <>
            <Columns
              data={rateSeries.map((p) => ({
                key: p.monthId,
                axisLabel: fmtMonthAxis(p.monthId, lang),
                fullLabel: fmtMonth(p.monthId, lang, true),
                value: p.rate,
                inProgress: p.inProgress,
                projected: p.projectedRate,
              }))}
              fmtValue={(n) => fmtPercent(n, lang)}
              fmtTick={(n) => fmtPercent(n, lang)}
              title={t('stats.savingsRate')}
            />
            {rateSeries.some((p) => p.inProgress) && (
              <p className="mt-2 text-[11px] text-muted">{t('stats.inProgressNote')}</p>
            )}
            {tables && (
              <DataTable
                caption={t('stats.savingsRate')}
                columns={[t('common.month'), t('fields.income'), t('totals.total'), t('stats.savingsRate')]}
                rows={rateSeries.map((p) => [
                  fmtMonth(p.monthId, lang),
                  fmtNumber(p.incomeJpy, lang),
                  fmtNumber(p.spentJpy, lang),
                  p.rate === null ? '—' : fmtPercent(p.rate, lang),
                ])}
              />
            )}
          </>
        ) : (
          <p className="text-sm text-muted">{t('stats.savingsRateNoIncome')}</p>
        )}
      </Collapsible>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* reparto del mes en foco */}
        <Collapsible
          id="stats.distribution"
          title={`${t('stats.distribution')} · ${fmtMonth(focusId, lang, true)}`}
          summary={`${compact(focus.totalJpy)} ¥`}
        >
          <Donut
            data={donutData}
            centerLabel={t('totals.total')}
            centerValue={`${compact(focus.totalJpy)} ¥`}
            fmtValue={(n) => `${compact(n)} ¥`}
            title={t('stats.distribution')}
          />
          {tables && (
            <DataTable
              caption={t('stats.distribution')}
              columns={[t('common.category'), t('common.jpy'), cur, t('stats.share')]}
              rows={donutData.map((d) => [
                d.label,
                fmtNumber(d.value, lang),
                fmtMoney(d.value * focus.fxRate, cur, lang),
                focus.totalJpy ? `${Math.round((d.value / focus.totalJpy) * 100)}%` : '—',
              ])}
            />
          )}
        </Collapsible>

        <Collapsible
          id="stats.topLabels"
          title={t('stats.topLabels')}
          hint={t('stats.topLabelsHint')}
          summary={labels.length ? `${compact(labels[0].totalJpy)} ¥` : t('common.none')}
        >
          <HBars
            data={labels.map((l) => ({
              key: l.label,
              label: l.label || '—',
              value: l.totalJpy,
              color: seriesVar(cats.find((c) => c.id === l.categoryId)?.colorSlot ?? 0),
            }))}
            fmtValue={(n) => `${compact(n)} ¥`}
            title={t('stats.topLabels')}
          />
          {tables && (
            <DataTable
              caption={t('stats.topLabels')}
              columns={[t('fields.label'), t('stats.count'), t('common.jpy'), t('stats.avg')]}
              rows={labels.map((l) => [
                l.label || '—',
                l.count,
                fmtNumber(l.totalJpy, lang),
                fmtNumber(l.avgJpy, lang),
              ])}
            />
          )}
        </Collapsible>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* media diaria por mes */}
        <Collapsible id="stats.perDay" title={t('stats.perDay')} summary={jpy(stats.perDayJpy)}>
          <Lines
            data={perDayPoints}
            series={[{ key: 'day', label: t('stats.perDay'), color: seriesVar(0) }]}
            fmtValue={jpy}
            fmtTick={compact}
            fmtX={(x) => fmtMonthAxis(stats.months[x]?.monthId ?? '', lang)}
            title={t('stats.perDay')}
            area
          />
          {tables && (
            <DataTable
              caption={t('stats.perDay')}
              columns={[t('common.month'), t('stats.perDay'), t('stats.count')]}
              rows={stats.months.map((m) => [
                fmtMonth(m.monthId, lang),
                fmtNumber(m.perDayJpy, lang),
                m.count,
              ])}
            />
          )}
        </Collapsible>

        <Collapsible
          id="stats.burn"
          title={`${t('stats.burn')} · ${fmtMonth(focusId, lang)}`}
          hint={t('stats.burnHint')}
          summary={jpy(focus.totalJpy)}
        >
          {hasDays ? (
            <>
              <Lines
                data={burn.map((b) => ({
                  x: b.day,
                  label: `${b.day}`,
                  values: { acc: b.cumulativeJpy, 'ref:pace': b.paceJpy },
                }))}
                series={[
                  { key: 'acc', label: t('totals.total'), color: seriesVar(0) },
                  { key: 'ref:pace', label: t('totals.limit'), color: 'var(--axis)' },
                ]}
                fmtValue={jpy}
                fmtTick={compact}
                fmtX={(_, label) => label}
                title={t('stats.burn')}
              />
              {tables && (
                <DataTable
                  caption={t('stats.burn')}
                  columns={[t('fields.day'), t('totals.total'), t('totals.limit')]}
                  rows={burn.map((b) => [b.day, fmtNumber(b.cumulativeJpy, lang), fmtNumber(b.paceJpy, lang)])}
                />
              )}
            </>
          ) : (
            <p className="text-sm text-muted">{t('stats.burnNoDays')}</p>
          )}
        </Collapsible>
      </div>

      {/* fijos y suscripciones: el goteo, no el total del mes */}
      <Collapsible
        id="stats.recurring"
        title={t('stats.recurring')}
        hint={t('stats.recurringHint')}
        summary={`${compact(recurringYearlyJpy)} ¥`}
      >
        {recurring.length === 0 ? (
          <p className="text-sm text-muted">{t('stats.recurringEmpty')}</p>
        ) : (
          <>
            <ul>
              {recurring.map((r) => (
                <li
                  key={r.label}
                  className="flex items-baseline justify-between gap-3 border-t border-hairline py-2 first:border-0"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{
                          background: seriesVar(
                            cats.find((c) => c.id === r.categoryId)?.colorSlot ?? 0,
                          ),
                        }}
                      />
                      <span className="truncate text-sm text-ink">{r.label || '—'}</span>
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted">
                      {r.everyMonths === null
                        ? t('stats.onceOnly')
                        : r.everyMonths <= 1
                          ? t('stats.everyMonth')
                          : t('stats.everyNMonths', {
                              // "cada 3 meses", no "cada 3,0 meses"
                              n: fmtNumber(r.everyMonths, lang, r.everyMonths % 1 === 0 ? 0 : 1),
                            })}
                      {' · '}
                      {compact(r.yearlyJpy)} ¥ {t('stats.perYear')}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm tabular-nums text-ink">{jpy(r.amountJpy)}</span>
                    {r.changeRatio !== null && (
                      <span
                        className="mt-0.5 block text-[11px] tabular-nums"
                        title={t('stats.wasBefore', { amount: jpy(r.previousAmountJpy!) })}
                        style={{ color: r.raised ? 'var(--critical)' : 'var(--good-text)' }}
                      >
                        {r.raised
                          ? t('stats.raised', { pct: fmtPercent(r.changeRatio, lang) })
                          : t('stats.lowered', { pct: fmtPercent(Math.abs(r.changeRatio), lang) })}
                      </span>
                    )}
                  </span>
                </li>
              ))}
              <li className="flex items-baseline justify-between gap-3 border-t border-hairline pt-2 text-sm font-semibold text-ink">
                <span>{t('stats.recurringYearTotal')}</span>
                <span className="tabular-nums">{jpy(recurringYearlyJpy)}</span>
              </li>
            </ul>
            {tables && (
              <DataTable
                caption={t('stats.recurring')}
                columns={[
                  t('fields.label'),
                  t('common.amount'),
                  t('stats.count'),
                  t('stats.perYear'),
                ]}
                rows={recurring.map((r) => [
                  r.label || '—',
                  fmtNumber(r.amountJpy, lang),
                  r.monthCount,
                  fmtNumber(r.yearlyJpy, lang),
                ])}
              />
            )}
          </>
        )}
      </Collapsible>

      {/* ticket medio por trimestre: mes a mes seria ruido */}
      <Collapsible
        id="stats.ticket"
        title={t('stats.ticket')}
        hint={t('stats.ticketHint')}
        summary={ticket.length ? `${compact(ticket.at(-1)!.avgJpy)} ¥` : t('common.none')}
      >
        {labels.length === 0 ? (
          <p className="text-sm text-muted">{t('stats.noData')}</p>
        ) : (
          <>
            <div className="mb-3 max-w-xs">
              <Select
                value={ticketPick}
                ariaLabel={t('stats.ticketPick')}
                onChange={setTicketLabel}
                options={labels.map((l) => ({ value: l.label, label: l.label || '—' }))}
              />
            </div>
            {ticket.length === 0 ? (
              <p className="text-sm text-muted">{t('stats.ticketEmpty')}</p>
            ) : (
              <>
                <Lines
                  data={ticket.map((q, i) => ({
                    x: i,
                    label: q.quarterId,
                    values: { avg: q.avgJpy },
                  }))}
                  series={[{ key: 'avg', label: t('stats.ticket'), color: seriesVar(4) }]}
                  fmtValue={jpy}
                  fmtTick={compact}
                  fmtX={(_, label) => label}
                  title={t('stats.ticket')}
                  area
                />
                <DataTable
                  caption={t('stats.ticket')}
                  columns={[t('stats.quarter'), t('stats.ticketCount'), t('stats.avg'), t('common.total')]}
                  rows={ticket.map((q) => [
                    q.quarterId,
                    q.count,
                    fmtNumber(q.avgJpy, lang),
                    fmtNumber(q.totalJpy, lang),
                  ])}
                />
              </>
            )}
          </>
        )}
      </Collapsible>

      <Collapsible
        id="stats.yoy"
        title={`${t('stats.yoy')} · ${yoy.year}`}
        hint={t('stats.yoyHint')}
        summary={
          yoy.comparable > 0 ? (
            <span style={{ color: yoy.ratio <= 0 ? 'var(--good-text)' : 'var(--critical)' }}>
              {fmtSignedPercent(yoy.ratio, lang)}
            </span>
          ) : (
            t('common.none')
          )
        }
      >
        {yoy.comparable === 0 ? (
          <p className="text-sm text-muted">{t('stats.yoyNoData')}</p>
        ) : (
          <>
            <Lines
              data={yoy.points.map((p) => ({
                x: p.month,
                label: monthNames[p.month - 1],
                values: { current: p.currentJpy, previous: p.previousJpy },
              }))}
              series={[
                { key: 'current', label: `${t('stats.thisYear')} (${yoy.year})`, color: seriesVar(0) },
                {
                  key: 'previous',
                  label: `${t('stats.lastYear')} (${yoy.year - 1})`,
                  color: seriesVar(1),
                },
              ]}
              fmtValue={jpy}
              fmtTick={compact}
              fmtX={(_, label) => label}
              title={t('stats.yoy')}
            />
            <p className="mt-2 text-xs text-muted">
              {t('stats.thisYear')}: <span className="tabular-nums">{jpy(yoy.currentTotal)}</span> ·{' '}
              {t('stats.lastYear')}: <span className="tabular-nums">{jpy(yoy.previousTotal)}</span> ·{' '}
              {yoy.comparable} {t(yoy.comparable === 1 ? 'stats.monthsOne' : 'stats.months')}{' '}
              ({fmtPercent(yoy.ratio, lang)} {t('stats.yoyDelta')})
            </p>
            {tables && (
              <DataTable
                caption={t('stats.yoy')}
                columns={[t('common.month'), String(yoy.year), String(yoy.year - 1), t('stats.yoyDelta')]}
                rows={yoy.points
                  .filter((p) => p.currentJpy !== null || p.previousJpy !== null)
                  .map((p) => [
                    monthNames[p.month - 1],
                    p.currentJpy === null ? '—' : fmtNumber(p.currentJpy, lang),
                    p.previousJpy === null ? '—' : fmtNumber(p.previousJpy, lang),
                    p.currentJpy !== null && p.previousJpy
                      ? fmtSignedPercent(p.currentJpy / p.previousJpy - 1, lang)
                      : '—',
                  ])}
              />
            )}
          </>
        )}
      </Collapsible>

      <Collapsible
        id="stats.topExpenses"
        title={t('stats.topExpenses')}
        summary={biggest.length ? `${compact(biggest[0].amount)} ¥` : t('common.none')}
      >
        {/* el selector vive dentro: la cabecera plegable no lleva controles,
            que pulsarlos abriria y cerraria la tarjeta sin querer */}
        <div className="mb-3">
          <Segmented<BiggestScope>
            label={t('stats.topExpenses')}
            value={biggestScope}
            onChange={setBiggestScope}
            options={[
              { id: 'period', label: t('stats.scopePeriod') },
              { id: 'month', label: `${t('stats.scopeMonth')} (${fmtMonth(focusId, lang)})` },
            ]}
          />
        </div>
        <DataTable
          caption={t('stats.topExpenses')}
          columns={[t('fields.label'), t('common.month'), t('common.category'), t('common.jpy')]}
          rows={biggest.map((e) => [
            e.label || '—',
            fmtMonth(e.monthId, lang),
            catLabel(e.categoryId),
            fmtNumber(e.amount, lang),
          ])}
        />
      </Collapsible>

      <Collapsible
        id="stats.noCost"
        title={`🎁 ${t('stats.noCost')}`}
        hint={t('stats.noCostHint')}
        summary={gifts.length ? `${compact(sum(gifts.map((g) => g.amount)))} ¥` : t('common.none')}
      >
        {gifts.length === 0 ? (
          <p className="text-sm text-muted">{t('stats.noCostEmpty')}</p>
        ) : (
          <DataTable
            caption={t('stats.noCost')}
            columns={[t('fields.label'), t('common.month'), t('common.category'), t('common.jpy')]}
            rows={gifts.map((e) => [
              e.label || '—',
              fmtMonth(e.monthId, lang),
              catLabel(e.categoryId),
              fmtNumber(e.amount, lang),
            ])}
          />
        )}
      </Collapsible>
    </div>
  )
}
