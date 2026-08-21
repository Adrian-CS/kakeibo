import { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import {
  categoryLimitsJpy,
  computeStats,
  projectSavings,
  recentActiveAverageJpy,
  snapshotSeries,
  sum,
} from '../lib/calc'
import { fmtDate, fmtJpy, fmtMoney, fmtNumber, parseAmount } from '../lib/format'
import { seriesVar } from '../lib/palette'
import {
  Button,
  Card,
  ConfirmButton,
  Field,
  Icon,
  IconButton,
  NumberInput,
  Select,
  StatTile,
  TextInput,
} from '../components/ui'
import { DataTable, Lines } from '../components/charts'
import { uid } from '../lib/id'
import type { Account, Snapshot } from '../lib/types'

function todayIso(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function SnapshotCard({ snapshot }: { snapshot: Snapshot }) {
  const { dispatch, data, t } = useStore()
  const lang = data.settings.lang
  const fx = data.settings.defaultFxRate

  const patch = (p: Partial<Snapshot>) =>
    dispatch({ type: 'upsertSnapshot', snapshot: { ...snapshot, ...p } })

  const patchAccount = (id: string, p: Partial<Account>) =>
    patch({ accounts: snapshot.accounts.map((a) => (a.id === id ? { ...a, ...p } : a)) })

  const net = snapshot.accounts.reduce((acc, a) => {
    const jpy = a.currency === 'JPY' ? a.amount : fx > 0 ? a.amount / fx : 0
    return acc + (a.isDebt ? -jpy : jpy)
  }, 0)

  return (
    <Card
      title={fmtDate(snapshot.date, lang)}
      actions={
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tabular-nums text-ink">{fmtJpy(net, lang)}</span>
          <ConfirmButton
            confirmLabel={`${t('action.delete')}?`}
            onConfirm={() => dispatch({ type: 'deleteSnapshot', id: snapshot.id })}
          >
            <Icon name="trash" />
          </ConfirmButton>
        </div>
      }
    >
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Field label={t('fields.date')}>
          <input
            type="date"
            value={snapshot.date}
            onChange={(e) => patch({ date: e.target.value })}
            className="w-full rounded-lg border border-hairline bg-surface px-2.5 py-2 text-sm text-ink"
          />
        </Field>
        <Field label={t('fields.note')}>
          <TextInput value={snapshot.note ?? ''} onChange={(e) => patch({ note: e.target.value })} />
        </Field>
      </div>

      <ul className="space-y-1">
        {snapshot.accounts.map((a) => (
          <li key={a.id} className="grid grid-cols-[1fr_5.5rem_3.5rem_auto] items-center gap-1.5">
            <TextInput
              value={a.name}
              placeholder={t('savings.account')}
              onChange={(e) => patchAccount(a.id, { name: e.target.value })}
              className="w-full min-w-0"
            />
            <NumberInput
              value={a.amount}
              onChange={(e) => {
                const n = parseAmount(e.target.value)
                if (n !== null) patchAccount(a.id, { amount: n })
              }}
              className="w-full px-1.5"
            />
            <Select
              value={a.currency}
              ariaLabel={t('fields.currency')}
              onChange={(v) => patchAccount(a.id, { currency: v as Account['currency'] })}
              options={[
                { value: 'JPY', label: '¥' },
                { value: 'EUR', label: '€' },
              ]}
              className="w-full px-1.5 pr-5"
            />
            <span className="flex items-center gap-0.5">
              <label
                className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-[11px] hover:bg-surface-2"
                title={t('savings.isDebt')}
              >
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={!!a.isDebt}
                  onChange={(e) => patchAccount(a.id, { isDebt: e.target.checked })}
                  aria-label={`${t('savings.isDebt')}: ${a.name}`}
                />
                <span
                  aria-hidden="true"
                  className={`grid h-5 w-5 place-items-center rounded-md border text-[13px] font-semibold ${
                    a.isDebt
                      ? 'border-transparent bg-[var(--critical)] text-white'
                      : 'border-hairline text-muted'
                  }`}
                >
                  −
                </span>
              </label>
              <IconButton
                label={t('action.delete')}
                className="h-9 w-9"
                onClick={() => patch({ accounts: snapshot.accounts.filter((x) => x.id !== a.id) })}
              >
                <Icon name="trash" />
              </IconButton>
            </span>
          </li>
        ))}
      </ul>

      <Button
        size="sm"
        className="mt-2"
        onClick={() =>
          patch({
            accounts: [
              ...snapshot.accounts,
              { id: uid('a'), name: '', amount: 0, currency: 'JPY' as const },
            ],
          })
        }
      >
        <Icon name="plus" />
        {t('savings.account')}
      </Button>
    </Card>
  )
}

export function SavingsView() {
  const { data, dispatch, t } = useStore()
  const lang = data.settings.lang
  const cur = data.settings.secondaryCurrency
  const [tables, setTables] = useState(false)

  const series = useMemo(() => snapshotSeries(data), [data])
  const stats = useMemo(() => computeStats(data, { lastMonths: 6 }), [data])
  const last = series.at(-1)
  const prev = series.at(-2)
  const runway = last && stats.averageJpy > 0 ? last.netJpy / stats.averageJpy : 0
  const projection = useMemo(() => projectSavings(data, [3, 6, 12]), [data])
  // mismas bases que usa projectSavings, solo para mostrar el desglose
  const projectedIncomeJpy = data.settings.defaultIncomeJpy
  const projectedCategorySpendJpy =
    categoryLimitsJpy(data.categories) +
    data.settings.defaultRentJpy +
    sum(data.settings.defaultExtras.map((x) => x.amount))
  const recentAverageJpy = useMemo(() => recentActiveAverageJpy(data, 6), [data])

  const addSnapshot = () => {
    const template = series.length ? data.snapshots.find((s) => s.id === last?.id) : undefined
    dispatch({
      type: 'upsertSnapshot',
      snapshot: {
        id: uid('s'),
        date: todayIso(),
        accounts: template
          ? template.accounts.map((a) => ({ ...a, id: uid('a') }))
          : [{ id: uid('a'), name: '', amount: 0, currency: 'JPY' }],
      },
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-base font-semibold text-ink">{t('savings.title')}</h1>
        <Button variant="primary" size="sm" onClick={addSnapshot}>
          <Icon name="plus" />
          {t('savings.add')}
        </Button>
      </div>

      {series.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">{t('savings.empty')}</p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <StatTile
              label={t('savings.net')}
              value={fmtJpy(last?.netJpy ?? 0, lang)}
              secondary={fmtMoney((last?.netJpy ?? 0) * data.settings.defaultFxRate, cur, lang)}
              delta={
                prev
                  ? `${(last!.netJpy - prev.netJpy >= 0 ? '+' : '') + fmtNumber(last!.netJpy - prev.netJpy, lang)} ¥`
                  : undefined
              }
              deltaGood={prev ? last!.netJpy >= prev.netJpy : undefined}
            />
            <StatTile label={t('savings.assets')} value={fmtJpy(last?.assetsJpy ?? 0, lang)} />
            <StatTile label={t('savings.debts')} value={fmtJpy(last?.debtsJpy ?? 0, lang)} />
            <StatTile
              label={t('savings.months')}
              value={fmtNumber(runway, lang, 1)}
              hint={t('savings.monthsHint')}
            />
          </div>

          <Card
            title={t('savings.evolution')}
            actions={
              <Button size="sm" onClick={() => setTables((v) => !v)}>
                {tables ? t('action.chart') : t('action.table')}
              </Button>
            }
          >
            <Lines
              data={series.map((s, i) => ({
                x: i,
                label: fmtDate(s.date, lang),
                values: { net: s.netJpy, assets: s.assetsJpy },
              }))}
              series={[
                { key: 'net', label: t('savings.net'), color: seriesVar(0) },
                { key: 'assets', label: t('savings.assets'), color: seriesVar(2) },
              ]}
              fmtValue={(n) => fmtJpy(n, lang)}
              fmtTick={(n) => fmtNumber(n / 1000, lang) + 'k'}
              fmtX={(x) => fmtDate(series[x]?.date ?? '', lang).replace(/ de /g, ' ')}
              title={t('savings.evolution')}
              area
            />
            {tables && (
              <DataTable
                caption={t('savings.evolution')}
                columns={[t('fields.date'), t('savings.assets'), t('savings.debts'), t('savings.net')]}
                rows={series.map((s) => [
                  fmtDate(s.date, lang),
                  fmtNumber(s.assetsJpy, lang),
                  fmtNumber(s.debtsJpy, lang),
                  fmtNumber(s.netJpy, lang),
                ])}
              />
            )}
          </Card>

          {projection.length > 0 && (
            <Card title={t('savings.forecast')} hint={t('savings.forecastHint')}>
              <div className="grid grid-cols-3 gap-2">
                {projection.map((h) => (
                  <StatTile
                    key={h.months}
                    label={t('savings.forecastIn', { n: h.months })}
                    value={fmtJpy(h.worstCaseJpy, lang)}
                    hint={t('totals.savingsWorstLimitHint', {
                      income: fmtJpy(projectedIncomeJpy, lang),
                      limit: fmtJpy(data.settings.defaultLimitJpy, lang),
                    })}
                  >
                    <p
                      className="mt-1 text-[11px] text-muted"
                      title={t('totals.savingsWorstCategoryLimitsHint', {
                        income: fmtJpy(projectedIncomeJpy, lang),
                        spend: fmtJpy(projectedCategorySpendJpy, lang),
                      })}
                    >
                      {t('totals.savingsWorstCategoryLimits')}: {fmtJpy(h.worstCaseByCategoryJpy, lang)}
                    </p>
                    <p
                      className="mt-1 text-[11px] text-muted"
                      title={t('totals.savingsRealisticHint', {
                        income: fmtJpy(projectedIncomeJpy, lang),
                        avg: fmtJpy(recentAverageJpy, lang),
                      })}
                    >
                      {t('totals.savingsRealistic')}: {fmtJpy(h.realisticJpy, lang)}
                    </p>
                  </StatTile>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {[...data.snapshots]
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((s) => (
            <SnapshotCard key={s.id} snapshot={s} />
          ))}
      </div>
    </div>
  )
}
