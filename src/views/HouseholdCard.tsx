import { useState } from 'react'
import { useStore } from '../state/store'
import { useHousehold } from '../state/household'
import { fmtWhen } from '../lib/format'
import { activeCategories, categoryLabel } from '../lib/calc'
import { Button, Card, ConfirmButton, Field, Select, TextInput } from '../components/ui'

export function HouseholdCard() {
  const { t, data, dispatch } = useStore()
  const household = useHousehold()
  const lang = data.settings.lang
  const [email, setEmail] = useState('')

  const working = household.status === 'working'

  const setCategoryLink = (categoryId: string, partnerCategoryId: string) => {
    const rest = data.settings.householdCategoryLinks.filter((l) => l.categoryId !== categoryId)
    const next = partnerCategoryId ? [...rest, { categoryId, partnerCategoryId }] : rest
    dispatch({ type: 'patchSettings', patch: { householdCategoryLinks: next } })
  }

  return (
    <Card title={t('household.title')} hint={t('household.hint')}>
      {household.status === 'error' && household.message && (
        <p className="mb-3 text-sm text-[var(--critical)]">
          {t('sync.error')}: {household.message}
        </p>
      )}

      {household.status === 'unavailable' ? (
        <p className="text-sm text-muted">{t('household.needsSync')}</p>
      ) : (
        <div className="space-y-4">
          {/* invitar */}
          {!household.partnerLink && (
            <div className="flex flex-wrap items-end gap-2">
              <Field label={t('household.inviteEmail')} className="flex-1">
                <TextInput
                  type="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </Field>
              <Button
                variant="primary"
                disabled={!email.includes('@') || working}
                onClick={() => {
                  void household.invite(email).then(() => setEmail(''))
                }}
              >
                {working ? t('sync.working') : t('household.invite')}
              </Button>
            </div>
          )}

          {/* invitaciones que he mandado */}
          {household.sentPending.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-ink-2">{t('household.sent')}</p>
              <ul className="space-y-1">
                {household.sentPending.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-ink-2">{l.inviteeEmail}</span>
                    <ConfirmButton
                      size="sm"
                      confirmLabel={`${t('action.cancel')}?`}
                      onConfirm={() => void household.revoke(l.id)}
                    >
                      {t('action.cancel')}
                    </ConfirmButton>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* invitaciones que me han mandado */}
          {household.receivedPending.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-ink-2">{t('household.received')}</p>
              <ul className="space-y-1">
                {household.receivedPending.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-ink-2">{l.inviteeEmail}</span>
                    <span className="flex gap-1.5">
                      <Button size="sm" variant="primary" onClick={() => void household.accept(l.id)}>
                        {t('household.accept')}
                      </Button>
                      <Button size="sm" onClick={() => void household.decline(l.id)}>
                        {t('household.decline')}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* vinculo activo */}
          {household.partnerLink && (
            <div className="space-y-3">
              <p className="text-sm text-ink-2">
                {t('household.linkedWith')}{' '}
                <span className="font-medium text-ink">{household.partnerLink.inviteeEmail}</span>
              </p>
              <p className="text-xs text-muted">
                {t('household.partnerDataAt')}:{' '}
                <span className="tabular-nums">
                  {household.partnerData?.updatedAt
                    ? fmtWhen(household.partnerData.updatedAt, lang)
                    : t('sync.never')}
                </span>
              </p>
              <ConfirmButton
                confirmLabel={`${t('household.unlink')}?`}
                onConfirm={() => void household.unlink(household.partnerLink!.id)}
              >
                {t('household.unlink')}
              </ConfirmButton>

              {/* enlace de categorias */}
              {household.partnerData && (
                <div className="border-t border-hairline pt-3">
                  <p className="mb-1 text-xs font-medium text-ink-2">{t('household.categoryLinks')}</p>
                  <p className="mb-2 text-[11px] text-muted">{t('household.categoryLinksHint')}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {activeCategories(data.categories).map((c) => {
                      const current =
                        data.settings.householdCategoryLinks.find((l) => l.categoryId === c.id)
                          ?.partnerCategoryId ?? ''
                      return (
                        <Field key={c.id} label={categoryLabel(c, lang)}>
                          <Select
                            value={current}
                            onChange={(v) => setCategoryLink(c.id, v)}
                            options={[
                              { value: '', label: t('household.noEquivalent') },
                              ...activeCategories(household.partnerData!.categories).map((pc) => ({
                                value: pc.id,
                                label: categoryLabel(pc, lang),
                              })),
                            ]}
                          />
                        </Field>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <p className="mt-3 text-xs text-muted">{t('household.help')}</p>
    </Card>
  )
}
