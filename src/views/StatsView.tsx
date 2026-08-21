import { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import {
  activeCategories,
  computeStats,
  computeYoy,
  datedCount,
  monthBurn,
  monthTotals,
  monthsWithData,
  topExpenses,
  topLabels,
} from '../lib/calc'
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
import { Card, Segmented, StatTile, Toggle } from '../components/ui'
import { DataTable, Donut, HBars, Lines, Sparkline, StackedColumns, type StackDatum } from '../components/charts'

type Range = '6' | '12' | '24' | 'all'

export function StatsView({ monthId }: { monthId: string }) {
  const { data, t } = useStore()
  const lang = data.settings.lang
  const cur = data.settings.secondaryCurrency

  const [range, setRange] = useState<Range>('12')
  const [excludeExtra, setExcludeExtra] = useState(false)
  const [tables, setTables] = useState(false)

  const lastMonths = range === 'all' ? 0 : Number(range)
  const cats = activeCategories(data.categories)

  const stats = useMemo(
    () => computeStats(data, { lastMonths, excludeExtraordinary: excludeExtra }),
    [data, lastMonths, excludeExtra],
  )

  const monthIds = stats.months.map((m) => m.monthId)
  const labels = useMemo(
    () => topLabels(data, { limit: 10, monthIds, excludeExtraordinary: excludeExtra }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, excludeExtra, monthIds.join(',')],
  )
  const biggest = useMemo(
    () => topExpenses(data, { limit: 8, monthIds, excludeExtraordinary: excludeExtra }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, excludeExtra, monthIds.join(',')],
  )

  const series = cats.map((c) => ({ key: c.id, label: c.name, color: seriesVar(c.colorSlot) }))
  const jpy = (n: number) => fmtJpy(n, lang)
  const compact = (n: number) => fmtCompact(n, lang)

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
  }))

  // el mes que se esta viendo, o el ultimo con datos
  const focusId = monthsWithData(data).includes(monthId) ? monthId : (stats.months.at(-1)?.monthId ?? monthId)
  const focus = monthTotals(data, focusId)

  const donutData = cats
    .map((c) => ({
      key: c.id,
      label: c.name,
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

  const yoy = computeYoy(data, focusId, { excludeExtraordinary: excludeExtra })
  const monthNames = Array.from({ length: 12 }, (_, i) =>
    fmtMonthAxis(`${yoy.year}-${String(i + 1).padStart(2, '0')}`, lang),
  )

  const burn = monthBurn(data, focusId)
  const hasDays = datedCount(data, focusId) > 0

  const momGood = stats.momRatio <= 0

  return (
    <div className="space-y-3">
      {/* una sola fila de filtros, encima de todo lo que afecta */}
      <div className="flex flex-wrap items-center gap-3">
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
          label={`${t('totals.total')} · ${fmtMonth(stats.months.at(-1)!.monthId, lang)}`}
          value={jpy(stats.currentJpy)}
          secondary={fmtMoney(stats.currentJpy * (stats.months.at(-1)?.fxRate ?? 0), cur, lang)}
          delta={
            stats.previousJpy > 0
              ? `${fmtSignedPercent(stats.momRatio, lang)} ${t('stats.vsPrev')}`
              : undefined
          }
          deltaGood={momGood}
        >
          <Sparkline values={stats.months.map((m) => m.totalJpy)} />
        </StatTile>
        <StatTile
          label={t('stats.avgMonth')}
          value={jpy(stats.averageJpy)}
          secondary={`${t('stats.median')}: ${compact(stats.medianJpy)} ¥`}
          hint={`${stats.months.length} ${t(stats.months.length === 1 ? 'stats.monthsOne' : 'stats.months')}`}
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
          title={t('stats.byCategoryMonth')}
        />
        {tables && (
          <DataTable
            caption={t('stats.byCategoryMonth')}
            columns={[t('common.month'), ...cats.map((c) => c.name), t('totals.total'), t('totals.limit')]}
            rows={stats.months.map((m) => [
              fmtMonth(m.monthId, lang),
              ...cats.map((c) => fmtNumber(m.byCategory[c.id] ?? 0, lang)),
              fmtNumber(m.totalJpy, lang),
              fmtNumber(m.limitJpy, lang),
            ])}
          />
        )}
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* reparto del mes en foco */}
        <Card title={`${t('stats.distribution')} · ${fmtMonth(focusId, lang, true)}`}>
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
        </Card>

        {/* ranking de conceptos */}
        <Card title={t('stats.topLabels')} hint={t('stats.topLabelsHint')}>
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
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* media diaria por mes */}
        <Card title={t('stats.perDay')}>
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
        </Card>

        {/* ritmo del mes */}
        <Card title={`${t('stats.burn')} · ${fmtMonth(focusId, lang)}`} hint={t('stats.burnHint')}>
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
                  rows={burn.map((b) => [
                    b.day,
                    fmtNumber(b.cumulativeJpy, lang),
                    fmtNumber(b.paceJpy, lang),
                  ])}
                />
              )}
            </>
          ) : (
            <p className="text-sm text-muted">{t('stats.burnNoDays')}</p>
          )}
        </Card>
      </div>

      {/* comparacion con el ano anterior */}
      <Card
        title={`${t('stats.yoy')} · ${yoy.year}`}
        hint={t('stats.yoyHint')}
        actions={
          yoy.comparable > 0 ? (
            <span
              className="text-sm font-semibold tabular-nums"
              style={{ color: yoy.ratio <= 0 ? 'var(--good-text)' : 'var(--critical)' }}
            >
              {fmtSignedPercent(yoy.ratio, lang)}
            </span>
          ) : undefined
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
      </Card>

      {/* gastos mas grandes */}
      <Card title={t('stats.topExpenses')}>
        <DataTable
          caption={t('stats.topExpenses')}
          columns={[t('fields.label'), t('common.month'), t('common.category'), t('common.jpy')]}
          rows={biggest.map((e) => [
            e.label || '—',
            fmtMonth(e.monthId, lang),
            cats.find((c) => c.id === e.categoryId)?.name ?? e.categoryId,
            fmtNumber(e.amount, lang),
          ])}
        />
      </Card>
    </div>
  )
}
