import { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import {
  categoryLimitsJpy,
  computeStats,
  debtAccounts,
  debtTotalJpy,
  expensesOfMonth,
  lastClosedMonthId,
  leakJpy,
  monthIncomeJpy,
  monthTotals,
  monthsOfRunway,
  projectSavings,
  recentActiveAverageJpy,
  savingsRate,
  snapshotSeries,
  sum,
} from '../lib/calc'
import { combinedProjectSavings, combinedSnapshotSeries, combinedStats } from '../lib/householdCalc'
import { emptyData } from '../lib/defaults'
import { useHousehold, type HouseholdViewScope } from '../state/household'
import { fmtDate, fmtJpy, fmtMoney, fmtMonth, fmtNumber, fmtPercent, parseAmount } from '../lib/format'
import { seriesVar } from '../lib/palette'
import {
  Button,
  Card,
  Collapsible,
  ConfirmButton,
  Field,
  Icon,
  IconButton,
  NumberInput,
  Segmented,
  Select,
  StatTile,
  TextInput,
} from '../components/ui'
import { DataTable, Lines } from '../components/charts'
import { uid } from '../lib/id'
import type { Account, AppData, Snapshot } from '../lib/types'

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
  const household = useHousehold()
  const lang = data.settings.lang
  const cur = data.settings.secondaryCurrency
  const [tables, setTables] = useState(false)
  const [scope, setScope] = useState<HouseholdViewScope>('mine')

  const links = data.settings.householdCategoryLinks
  const isTogether = scope === 'together'
  const isPartner = scope === 'partner'
  // "Juntos" combina los dos documentos con householdCalc.ts; "Pareja"
  // reutiliza tal cual las mismas funciones sobre el documento (de solo
  // lectura) de la pareja, igual que en Estadisticas.
  const source = isPartner ? (household.partnerData ?? emptyData()) : data
  const partnerMissing = isPartner && !household.partnerData

  const series = useMemo(
    () => (isTogether ? combinedSnapshotSeries(data, household.partnerData) : snapshotSeries(source)),
    [isTogether, data, household.partnerData, source],
  )
  const stats = useMemo(
    () =>
      isTogether
        ? combinedStats(data, household.partnerData, links, { lastMonths: 6 })
        : computeStats(source, { lastMonths: 6 }),
    [isTogether, data, household.partnerData, links, source],
  )
  const last = series.at(-1)
  const prev = series.at(-2)
  const recentAverageJpy = useMemo(
    () => (isTogether ? null : recentActiveAverageJpy(source, 6)),
    [isTogether, source],
  )
  // los documentos que entran en las cifras de arriba: en "Juntos", el mio y
  // el de mi pareja (cada uno con sus ingresos, su gasto y su tipo de cambio,
  // como hace householdCalc); en el resto, solo el que se esta mirando
  const sides = useMemo<AppData[]>(
    () =>
      isTogether
        ? [data, household.partnerData].filter((d): d is AppData => !!d)
        : [source],
    [isTogether, data, household.partnerData, source],
  )
  // mes de referencia de "tasa de ahorro" y "fuga": el ultimo ya cerrado, que
  // el mes en curso esta a medias y daria una tasa inmejorable el dia 2
  const refMonthId = useMemo(() => lastClosedMonthId(sides[0]), [sides])
  const rate = useMemo(() => {
    if (!refMonthId) return null
    if (!isTogether) return savingsRate(source, refMonthId)
    const income = sum(sides.map((d) => monthIncomeJpy(d, refMonthId)))
    if (income <= 0) return null
    return (income - sum(sides.map((d) => monthTotals(d, refMonthId).totalJpy))) / income
  }, [isTogether, refMonthId, sides, source])
  const leak = useMemo(
    () => (refMonthId ? sum(sides.map((d) => leakJpy(d, refMonthId))) : 0),
    [refMonthId, sides],
  )
  const leakItems = useMemo(
    () =>
      refMonthId
        ? sides
            .flatMap((d) => expensesOfMonth(d, refMonthId).filter((e) => e.kind === 'recurring'))
            .sort((a, b) => b.amount - a.amount)
        : [],
    [refMonthId, sides],
  )
  const debts = useMemo(() => sides.flatMap((d) => debtAccounts(d)), [sides])
  const debtsTotalJpy = useMemo(() => sum(sides.map((d) => debtTotalJpy(d))), [sides])
  // el colchon se mide al ritmo real de gasto (ver `monthsOfRunway`), no con
  // la media sin filtrar de `stats`: esa cuenta meses vacios o solo de gasto
  // fijo (por ejemplo el mes en curso, recien creado) y hunde la media,
  // inflando los meses de colchon muy por encima de lo real. En "Juntos" no
  // hay una media filtrada de los dos, asi que solo ahi se cae al promedio de
  // `stats`. Sin ninguna base fiable no se da numero: un "0 meses" leeria
  // como "sin colchon" en vez de "no hay suficiente historial".
  const runway = useMemo(() => {
    if (!isTogether) return monthsOfRunway(source)
    return last && stats.averageJpy > 0 ? last.assetsJpy / stats.averageJpy : null
  }, [isTogether, source, last, stats.averageJpy])
  const projection = useMemo(
    () =>
      isTogether
        ? combinedProjectSavings(data, household.partnerData, [3, 6, 12])
        : projectSavings(source, [3, 6, 12]),
    [isTogether, data, household.partnerData, source],
  )
  // mismas bases que usa projectSavings, solo para mostrar el desglose. En
  // "Juntos" no hay un unico ingreso/limite/tope de cada uno: se enseñan los
  // dos por separado (el tuyo + el de tu pareja), ya que el total del
  // pronostico tambien es la suma de los dos por separado
  const projectedIncomeJpy = source.settings.defaultIncomeJpy
  const projectedCategorySpendJpy =
    categoryLimitsJpy(source.categories) +
    source.settings.defaultRentJpy +
    sum(source.settings.defaultExtras.map((x) => x.amount))
  const partnerIncomeJpy = household.partnerData?.settings.defaultIncomeJpy ?? 0
  const partnerLimitJpy = household.partnerData?.settings.defaultLimitJpy ?? 0
  const partnerCategorySpendJpy = household.partnerData
    ? categoryLimitsJpy(household.partnerData.categories) +
      household.partnerData.settings.defaultRentJpy +
      sum(household.partnerData.settings.defaultExtras.map((x) => x.amount))
    : 0
  // "tuyo + de tu pareja" en vez de un solo numero, para que el desglose de
  // "Juntos" siga siendo trazable en vez de ocultarse sin mas
  const incomeText = isTogether
    ? `${fmtJpy(projectedIncomeJpy, lang)} + ${fmtJpy(partnerIncomeJpy, lang)}`
    : fmtJpy(projectedIncomeJpy, lang)
  const limitText = isTogether
    ? `${fmtJpy(source.settings.defaultLimitJpy, lang)} + ${fmtJpy(partnerLimitJpy, lang)}`
    : fmtJpy(source.settings.defaultLimitJpy, lang)
  const spendText = isTogether
    ? `${fmtJpy(projectedCategorySpendJpy, lang)} + ${fmtJpy(partnerCategorySpendJpy, lang)}`
    : fmtJpy(projectedCategorySpendJpy, lang)

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-base font-semibold text-ink">{t('savings.title')}</h1>
        <div className="flex items-center gap-2">
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
          {scope === 'mine' && (
            <Button variant="primary" size="sm" onClick={addSnapshot}>
              <Icon name="plus" />
              {t('savings.add')}
            </Button>
          )}
        </div>
      </div>

      {partnerMissing ? (
        <Card>
          <p className="text-sm text-muted">{t('household.noPartnerDataYet')}</p>
        </Card>
      ) : series.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">{t('savings.empty')}</p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
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
              label={t('savings.rate')}
              value={rate === null ? t('common.none') : fmtPercent(rate, lang)}
              secondary={refMonthId ? fmtMonth(refMonthId, lang) : undefined}
              hint={rate === null ? t('savings.rateUnknownHint') : t('savings.rateHint')}
            />
            <StatTile
              label={t('savings.leak')}
              value={fmtJpy(leak, lang)}
              secondary={refMonthId ? fmtMonth(refMonthId, lang) : t('savings.refMonthNone')}
              hint={t('savings.leakHint')}
            />
            <StatTile
              label={t('savings.months')}
              value={runway === null ? t('common.none') : fmtNumber(runway, lang, 1)}
              hint={runway === null ? t('savings.monthsUnknownHint') : t('savings.monthsHint')}
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
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {projection.map((h) => (
                  <StatTile
                    key={h.months}
                    label={t('savings.forecastIn', { n: h.months })}
                    value={fmtJpy(h.worstCaseJpy, lang)}
                    hint={t('totals.savingsWorstLimitHint', { income: incomeText, limit: limitText })}
                  >
                    <p
                      className="mt-1 text-[11px] text-muted"
                      title={t('totals.savingsWorstCategoryLimitsHint', {
                        income: incomeText,
                        spend: spendText,
                      })}
                    >
                      {t('totals.savingsWorstCategoryLimits')}: {fmtJpy(h.worstCaseByCategoryJpy, lang)}
                    </p>
                    <p
                      className="mt-1 text-[11px] text-muted"
                      title={
                        isTogether || recentAverageJpy === null
                          ? t('totals.savingsRealisticNoData')
                          : t('totals.savingsRealisticHint', { income: incomeText, avg: fmtJpy(recentAverageJpy, lang) })
                      }
                    >
                      {t('totals.savingsRealistic')}:{' '}
                      {h.realisticJpy === null ? t('common.none') : fmtJpy(h.realisticJpy, lang)}
                    </p>
                  </StatTile>
                ))}
              </div>
            </Card>
          )}

          <Collapsible
            id="savings.debts"
            title={t('savings.debtList')}
            hint={t('savings.debtListHint')}
            summary={fmtJpy(debtsTotalJpy, lang)}
          >
            {debts.length === 0 ? (
              <p className="text-sm text-muted">{t('savings.debtEmpty')}</p>
            ) : (
              <ul>
                {debts.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-baseline justify-between gap-3 border-t border-hairline py-1.5 first:border-0"
                  >
                    <span className="min-w-0 truncate text-sm text-ink">
                      {a.name || t('savings.account')}
                    </span>
                    <span className="shrink-0 text-sm tabular-nums text-[var(--critical)]">
                      {a.currency === 'JPY'
                        ? fmtJpy(a.amount, lang)
                        : fmtMoney(a.amount, a.currency, lang)}
                    </span>
                  </li>
                ))}
                <li className="flex items-baseline justify-between gap-3 border-t border-hairline pt-2 text-sm font-semibold text-ink">
                  <span>{t('savings.debtTotal')}</span>
                  <span className="tabular-nums">{fmtJpy(debtsTotalJpy, lang)}</span>
                </li>
              </ul>
            )}
            <p className="mt-3 text-[11px] text-muted">{t('savings.debtNote')}</p>
          </Collapsible>

          <Collapsible
            id="savings.leak"
            title={t('savings.leakCard')}
            hint={
              refMonthId
                ? t('savings.leakCardHint', { month: fmtMonth(refMonthId, lang) })
                : t('savings.refMonthNone')
            }
            summary={fmtJpy(leak, lang)}
            defaultOpen={false}
          >
            {leakItems.length === 0 ? (
              <p className="text-sm text-muted">{t('savings.leakEmpty')}</p>
            ) : (
              <ul>
                {leakItems.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-baseline justify-between gap-3 border-t border-hairline py-1.5 first:border-0"
                  >
                    <span className="min-w-0 truncate text-sm text-ink">
                      {e.label || t('fields.label')}
                    </span>
                    <span className="shrink-0 text-sm tabular-nums text-ink-2">
                      {fmtJpy(e.amount, lang)}
                    </span>
                  </li>
                ))}
                <li className="flex items-baseline justify-between gap-3 border-t border-hairline pt-2 text-sm font-semibold text-ink">
                  <span>{t('savings.debtTotal')}</span>
                  <span className="tabular-nums">{fmtJpy(leak, lang)}</span>
                </li>
              </ul>
            )}
            <p className="mt-3 text-[11px] text-muted">{t('savings.leakNote')}</p>
          </Collapsible>
        </>
      )}

      {/* fotos individuales: siempre las mias, nunca las de la pareja (de
          solo lectura, no tiene sentido editarlas ni mezclarlas aqui) */}
      {scope === 'mine' && (
        <div className="grid gap-3 lg:grid-cols-2">
          {[...data.snapshots]
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((s) => (
              <SnapshotCard key={s.id} snapshot={s} />
            ))}
        </div>
      )}
    </div>
  )
}
