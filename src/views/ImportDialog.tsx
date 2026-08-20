import { useRef, useState } from 'react'
import { useStore } from '../state/store'
import { parseWorkbook, toExpenses, type ParsedSheet } from '../lib/importExcel'
import { fmtJpy, fmtMonth } from '../lib/format'
import { Button, Field, Modal, Select, TextInput, Toggle } from '../components/ui'
import { isValidMonthId } from '../lib/calc'
import { newMonth } from '../lib/defaults'
import type { AppData } from '../lib/types'

interface Row extends ParsedSheet {
  assigned: string
  include: boolean
}

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, dispatch, t } = useStore()
  const lang = data.settings.lang
  const inputRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [replace, setReplace] = useState(true)
  const [done, setDone] = useState<string | null>(null)

  const reset = () => {
    setRows(null)
    setError(null)
    setDone(null)
  }

  const onFile = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const buf = new Uint8Array(await file.arrayBuffer())
      const result = parseWorkbook(buf)
      if (result.sheets.length === 0) {
        setError(t('import.none'))
        setRows(null)
      } else {
        setRows(
          result.sheets.map((s) => ({
            ...s,
            assigned: s.monthId ?? '',
            include: !!s.monthId,
          })),
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const doImport = () => {
    if (!rows) return
    const selected = rows.filter((r) => r.include && isValidMonthId(r.assigned))
    let next: AppData = { ...data }

    if (replace) {
      const ids = new Set(selected.map((r) => r.assigned))
      next = { ...next, expenses: next.expenses.filter((e) => !ids.has(e.monthId)) }
    }

    let added = 0
    for (const r of selected) {
      const id = r.assigned
      const expenses = toExpenses(r, id)
      added += expenses.length
      const existing = next.months.find((m) => m.id === id)
      const base = existing ?? newMonth(id, next.settings)
      const merged = {
        ...base,
        rentJpy: r.rentJpy ?? base.rentJpy,
        fxRate: r.fxRate ?? base.fxRate,
        limitJpy: r.limitJpy ?? base.limitJpy,
        extras: replace || !existing ? r.extras : [...base.extras, ...r.extras],
        note: [base.note, ...r.notes].filter(Boolean).join(' · ') || undefined,
      }
      next = {
        ...next,
        expenses: [...next.expenses, ...expenses],
        months: existing
          ? next.months.map((m) => (m.id === id ? merged : m))
          : [...next.months, merged],
      }
    }

    dispatch({ type: 'replace', data: next })
    setDone(t('import.done', { n: added, m: selected.length }))
    setRows(null)
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title={t('import.title')}
      footer={
        rows ? (
          <>
            <Button size="md" onClick={reset}>
              {t('action.cancel')}
            </Button>
            <Button size="md" variant="primary" onClick={doImport}>
              {t('import.confirm')}
            </Button>
          </>
        ) : undefined
      }
    >
      {done && <p className="mb-3 text-sm text-[var(--good-text)]">{done}</p>}

      {!rows && (
        <>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-hairline bg-surface-2 px-4 py-8 text-sm text-ink-2"
          >
            <span>{busy ? t('import.reading') : t('import.drop')}</span>
            <span className="text-xs text-muted">.xlsx</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void onFile(f)
              e.target.value = ''
            }}
          />
          <p className="mt-3 text-xs text-muted">{t('import.help')}</p>
        </>
      )}

      {error && <p className="mt-3 text-sm text-[var(--critical)]">{error}</p>}

      {rows && (
        <>
          <div className="mb-3">
            <Field label={t('import.mode')}>
              <Select
                value={replace ? 'replace' : 'merge'}
                onChange={(v) => setReplace(v === 'replace')}
                options={[
                  { value: 'replace', label: t('import.mode.replace') },
                  { value: 'merge', label: t('import.mode.merge') },
                ]}
              />
            </Field>
          </div>

          <p className="mb-2 text-xs font-medium text-ink-2">{t('import.sheets')}</p>
          <ul className="space-y-2">
            {rows.map((r, i) => {
              const duplicated =
                r.include &&
                rows.some((o, oi) => oi !== i && o.include && o.assigned === r.assigned)
              return (
              <li key={r.sheetName} className="rounded-lg border border-hairline p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{r.sheetName}</p>
                    <p className="text-xs text-muted">
                      {r.items.length} {t('import.items')} · {fmtJpy(r.totalJpy, lang)}
                    </p>
                  </div>
                  <Toggle
                    checked={r.include}
                    label=""
                    onChange={(v) =>
                      setRows((rs) => rs!.map((x, xi) => (xi === i ? { ...x, include: v } : x)))
                    }
                  />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <TextInput
                    value={r.assigned}
                    placeholder="YYYY-MM"
                    aria-label={t('import.assignMonth')}
                    onChange={(e) =>
                      setRows((rs) =>
                        rs!.map((x, xi) => (xi === i ? { ...x, assigned: e.target.value.trim() } : x)),
                      )
                    }
                    className="w-[110px] shrink-0 tabular-nums"
                  />
                  <span className="text-xs text-muted">
                    {isValidMonthId(r.assigned) ? fmtMonth(r.assigned, lang, true) : '—'}
                  </span>
                  {duplicated && (
                    <span className="text-xs text-[var(--serious)]">{t('import.duplicate')}</span>
                  )}
                </div>
              </li>
              )
            })}
          </ul>
        </>
      )}
    </Modal>
  )
}
