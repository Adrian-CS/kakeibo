import { useRef, useState } from 'react'
import { useStore } from '../state/store'
import { LANGS } from '../lib/i18n'
import { clearData, deserialize, exportFileName, serialize, storageSize } from '../lib/storage'
import { emptyData } from '../lib/defaults'
import { fmtNumber, parseAmount } from '../lib/format'
import { MAX_SLOTS, seriesVar } from '../lib/palette'
import type { Bucket, Category, Lang, ThemePref } from '../lib/types'
import {
  Button,
  Card,
  ConfirmButton,
  Field,
  Icon,
  IconButton,
  NumberInput,
  Segmented,
  Select,
  TextInput,
} from '../components/ui'
import { ImportDialog } from './ImportDialog'
import { SyncCard } from './SyncCard'
import { uid } from '../lib/id'
import { fetchFxRate } from '../lib/fx'
import { Toggle } from '../components/ui'

function CategoryRow({ category }: { category: Category }) {
  const { dispatch, data, t } = useStore()
  const patch = (p: Partial<Category>) =>
    dispatch({ type: 'upsertCategory', category: { ...category, ...p } })
  const used = data.expenses.filter((e) => e.categoryId === category.id).length

  return (
    <li className="flex flex-wrap items-center gap-1.5 border-b border-hairline py-2 last:border-0">
      <span
        aria-hidden="true"
        className="h-3 w-3 shrink-0 rounded-[2px]"
        style={{ background: seriesVar(category.colorSlot) }}
      />
      <TextInput
        value={category.name}
        onChange={(e) => patch({ name: e.target.value })}
        className="min-w-[7rem] flex-1"
        aria-label={t('fields.name')}
      />
      <Select
        value={category.bucket}
        ariaLabel={t('settings.bucket')}
        onChange={(v) => patch({ bucket: v as Bucket })}
        options={[
          { value: 'daily', label: t('settings.bucket.daily') },
          { value: 'other', label: t('settings.bucket.other') },
        ]}
        className="w-[7.5rem] shrink-0"
      />
      <Select
        value={String(category.colorSlot)}
        ariaLabel={t('settings.color')}
        onChange={(v) => patch({ colorSlot: Number(v) })}
        options={Array.from({ length: MAX_SLOTS }, (_, i) => ({ value: String(i), label: `${i + 1}` }))}
        className="w-[4.5rem] shrink-0"
      />
      <NumberInput
        value={category.limitJpy ?? ''}
        placeholder={t('cat.limitNone')}
        aria-label={`${t('cat.limit')}: ${category.name}`}
        onChange={(e) => {
          const n = parseAmount(e.target.value)
          patch({ limitJpy: n === null || n <= 0 ? undefined : n })
        }}
        className="w-[7rem] shrink-0"
      />
      <IconButton
        label="↑"
        className="h-8 w-8 shrink-0"
        onClick={() => dispatch({ type: 'moveCategory', id: category.id, dir: -1 })}
      >
        <span className="text-xs">↑</span>
      </IconButton>
      <IconButton
        label="↓"
        className="h-8 w-8 shrink-0"
        onClick={() => dispatch({ type: 'moveCategory', id: category.id, dir: 1 })}
      >
        <span className="text-xs">↓</span>
      </IconButton>
      <ConfirmButton
        confirmLabel={used ? `${t('action.delete')} ${used}?` : `${t('action.delete')}?`}
        onConfirm={() => dispatch({ type: 'deleteCategory', id: category.id })}
      >
        <Icon name="trash" />
      </ConfirmButton>
    </li>
  )
}

export function SettingsView() {
  const { data, dispatch, t } = useStore()
  const lang = data.settings.lang
  const [importOpen, setImportOpen] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [fxBusy, setFxBusy] = useState(false)
  const [fxMsg, setFxMsg] = useState<string | null>(null)

  const updateFx = async () => {
    setFxBusy(true)
    setFxMsg(null)
    try {
      const r = await fetchFxRate(data.settings.secondaryCurrency)
      dispatch({
        type: 'patchSettings',
        patch: { defaultFxRate: r.rate, fxUpdatedAt: r.date || undefined },
      })
      setFxMsg(t('fx.updated', { date: r.date }))
    } catch {
      setFxMsg(t('fx.error'))
    } finally {
      setFxBusy(false)
    }
  }

  const doExport = () => {
    const blob = new Blob([serialize(data)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = exportFileName()
    a.click()
    URL.revokeObjectURL(url)
  }

  const doImportJson = async (file: File) => {
    try {
      const text = await file.text()
      dispatch({ type: 'replace', data: deserialize(text) })
      setMsg(t('import.jsonDone'))
    } catch {
      setMsg(t('import.jsonError'))
    }
  }

  return (
    <div className="space-y-3">
      <h1 className="text-base font-semibold text-ink">{t('settings.title')}</h1>

      <Card title={t('settings.appearance')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('settings.lang')}>
            <Select
              value={lang}
              onChange={(v) => dispatch({ type: 'patchSettings', patch: { lang: v as Lang } })}
              options={LANGS.map((l) => ({ value: l.id, label: l.label }))}
            />
          </Field>
          <Field label={t('settings.theme')}>
            <Segmented<ThemePref>
              value={data.settings.theme}
              onChange={(v) => dispatch({ type: 'patchSettings', patch: { theme: v } })}
              options={[
                { id: 'system', label: t('settings.theme.system') },
                { id: 'light', label: t('settings.theme.light') },
                { id: 'dark', label: t('settings.theme.dark') },
              ]}
            />
          </Field>
        </div>
      </Card>

      <Card title={t('settings.defaults')}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('fields.rent')}>
            <NumberInput
              value={data.settings.defaultRentJpy}
              onChange={(e) => {
                const n = parseAmount(e.target.value)
                if (n !== null) dispatch({ type: 'patchSettings', patch: { defaultRentJpy: n } })
              }}
            />
          </Field>
          <Field label={t('fields.limit')}>
            <NumberInput
              value={data.settings.defaultLimitJpy}
              onChange={(e) => {
                const n = parseAmount(e.target.value)
                if (n !== null) dispatch({ type: 'patchSettings', patch: { defaultLimitJpy: n } })
              }}
            />
          </Field>
          <Field label={t('fields.fx')} hint={t('fields.fxHint')}>
            <NumberInput
              value={data.settings.defaultFxRate}
              onChange={(e) => {
                const n = parseAmount(e.target.value)
                if (n !== null) dispatch({ type: 'patchSettings', patch: { defaultFxRate: n } })
              }}
            />
          </Field>
          <Field label={t('common.secondary')}>
            <Select
              value={data.settings.secondaryCurrency}
              onChange={(v) =>
                dispatch({
                  type: 'patchSettings',
                  patch: { secondaryCurrency: v as 'EUR' | 'USD' | 'GBP' },
                })
              }
              options={[
                { value: 'EUR', label: 'EUR €' },
                { value: 'USD', label: 'USD $' },
                { value: 'GBP', label: 'GBP £' },
              ]}
            />
          </Field>
        </div>

        <div className="mt-4">
          <p className="mb-1 text-xs font-medium text-ink-2">{t('fields.extras')}</p>
          <p className="mb-2 text-[11px] text-muted">{t('settings.defaultExtrasHint')}</p>
          <ul className="space-y-1">
            {data.settings.defaultExtras.map((x) => (
              <li key={x.id} className="flex items-center gap-1.5">
                <TextInput
                  value={x.label}
                  onChange={(e) =>
                    dispatch({
                      type: 'patchSettings',
                      patch: {
                        defaultExtras: data.settings.defaultExtras.map((y) =>
                          y.id === x.id ? { ...y, label: e.target.value } : y,
                        ),
                      },
                    })
                  }
                  className="flex-1"
                />
                <NumberInput
                  value={x.amount}
                  onChange={(e) => {
                    const n = parseAmount(e.target.value)
                    if (n !== null)
                      dispatch({
                        type: 'patchSettings',
                        patch: {
                          defaultExtras: data.settings.defaultExtras.map((y) =>
                            y.id === x.id ? { ...y, amount: n } : y,
                          ),
                        },
                      })
                  }}
                  className="w-[92px] shrink-0"
                />
                <IconButton
                  label={t('action.delete')}
                  onClick={() =>
                    dispatch({
                      type: 'patchSettings',
                      patch: { defaultExtras: data.settings.defaultExtras.filter((y) => y.id !== x.id) },
                    })
                  }
                  className="h-9 w-9 shrink-0"
                >
                  <Icon name="trash" />
                </IconButton>
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            className="mt-1.5"
            onClick={() =>
              dispatch({
                type: 'patchSettings',
                patch: { defaultExtras: [...data.settings.defaultExtras, { id: uid('x'), label: '', amount: 0 }] },
              })
            }
          >
            <Icon name="plus" />
            {t('action.add')}
          </Button>
        </div>
      </Card>

      <Card title={t('settings.categories')} hint={`${t('settings.bucket')} · ${t('settings.color')} · ${t('cat.limit')}`}>
        <ul>
          {data.categories.map((c) => (
            <CategoryRow key={c.id} category={c} />
          ))}
        </ul>
        <Button
          size="sm"
          className="mt-2"
          onClick={() =>
            dispatch({
              type: 'upsertCategory',
              category: {
                id: uid('c'),
                name: '',
                bucket: 'other',
                colorSlot: data.categories.length % MAX_SLOTS,
              },
            })
          }
        >
          <Icon name="plus" />
          {t('settings.addCategory')}
        </Button>
      </Card>

      <Card title={t('settings.automation')} hint={t('settings.autoFillHint')}>
        <div className="space-y-3">
          <Toggle
            checked={data.settings.autoFillFixed}
            onChange={(v) => dispatch({ type: 'patchSettings', patch: { autoFillFixed: v } })}
            label={t('settings.autoFill')}
          />
          <div>
            <Toggle
              checked={data.settings.autoFxRate}
              onChange={(v) => dispatch({ type: 'patchSettings', patch: { autoFxRate: v } })}
              label={t('settings.autoFx')}
            />
            <p className="mt-1 text-[11px] text-muted">{t('settings.autoFxHint')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={fxBusy} onClick={() => void updateFx()}>
              {t('fx.update')}
            </Button>
            {fxMsg && <span className="text-xs text-muted">{fxMsg}</span>}
          </div>
        </div>
      </Card>

      <SyncCard />

      <Card title={t('settings.data')} hint={t('settings.dataHint')}>
        {msg && <p className="mb-3 text-sm text-[var(--good-text)]">{msg}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={doExport}>
            <Icon name="download" />
            {t('action.export')}
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" />
            {t('action.import')}
          </Button>
          <Button variant="primary" onClick={() => setImportOpen(true)}>
            {t('action.importXlsx')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void doImportJson(f)
              e.target.value = ''
            }}
          />
        </div>
        <p className="mt-3 text-xs text-muted">
          {t('settings.storage')}: {fmtNumber(storageSize() / 1024, lang, 1)} kB ·{' '}
          {data.expenses.length} {t('stats.count')} · {data.months.length} {t('stats.months')}
        </p>
        <div className="mt-3 border-t border-hairline pt-3">
          <ConfirmButton
            size="md"
            confirmLabel={`${t('action.reset')} — ${t('action.confirm')}`}
            onConfirm={() => {
              clearData()
              dispatch({ type: 'replace', data: emptyData() })
            }}
          >
            {t('action.reset')}
          </ConfirmButton>
          <p className="mt-1 text-xs text-muted">{t('settings.resetHint')}</p>
        </div>
      </Card>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  )
}
