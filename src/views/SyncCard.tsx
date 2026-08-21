import { useState } from 'react'
import { useStore } from '../state/store'
import { useSync } from '../state/sync'
import { fmtWhen } from '../lib/format'
import { Button, Card, ConfirmButton, Field, TextInput } from '../components/ui'

export function SyncCard() {
  const { t, data } = useStore()
  const sync = useSync()
  const lang = data.settings.lang

  const [url, setUrl] = useState(sync.config?.url ?? '')
  const [key, setKey] = useState(sync.config?.anonKey ?? '')
  const [email, setEmail] = useState(data.sync?.email ?? '')
  const [code, setCode] = useState('')

  const working = sync.status === 'working'

  return (
    <Card title={t('sync.title')} hint={t('sync.hint')}>
      {sync.status === 'error' && sync.message && (
        <p className="mb-3 text-sm text-[var(--critical)]">
          {t('sync.error')}: {sync.message}
        </p>
      )}

      {/* 1. configuracion del proyecto */}
      {!sync.config && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('sync.url')} hint="https://xxxx.supabase.co">
            <TextInput
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://xxxx.supabase.co"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label={t('sync.anonKey')}>
            <TextInput
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <div className="sm:col-span-2">
            <Button
              variant="primary"
              disabled={!url.trim() || !key.trim()}
              onClick={() => sync.setConfig({ url: url.trim(), anonKey: key.trim() })}
            >
              {t('sync.save')}
            </Button>
          </div>
        </div>
      )}

      {/* 2. entrar con el correo */}
      {sync.config && !sync.session && (
        <div className="grid gap-3 sm:grid-cols-2">
          {sync.redirectTo ? (
            <p className="text-xs text-muted sm:col-span-2">
              {t('sync.returnTo')}{' '}
              <code className="rounded bg-surface-2 px-1 py-0.5 text-ink-2">{sync.redirectTo}</code>
              <br />
              {t('sync.siteUrlHint')}
            </p>
          ) : (
            <p className="text-xs sm:col-span-2" style={{ color: 'var(--serious)' }}>
              {t('sync.noReturn')}
            </p>
          )}
          <Field label={t('sync.email')}>
            <TextInput
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </Field>
          <div className="flex items-end">
            <Button
              variant="primary"
              disabled={!email.includes('@') || working}
              onClick={() => void sync.requestCode(email)}
            >
              {working ? t('sync.working') : t('sync.sendCode')}
            </Button>
          </div>

          {sync.pendingCode && (
            <>
              <p className="text-xs text-muted sm:col-span-2">
                {t('sync.codeSent')} {t('sync.codeHint')}
              </p>
              <Field label={t('sync.code')}>
                <TextInput
                  value={code}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  onChange={(e) => setCode(e.target.value)}
                />
              </Field>
              <div className="flex items-end">
                <Button
                  disabled={code.trim().length < 6 || working}
                  onClick={() => void sync.submitCode(email, code)}
                >
                  {t('sync.enter')}
                </Button>
              </div>
            </>
          )}

          <div className="sm:col-span-2">
            <ConfirmButton confirmLabel={`${t('sync.forget')}?`} onConfirm={() => sync.setConfig(null)}>
              {t('sync.forget')}
            </ConfirmButton>
          </div>
        </div>
      )}

      {/* 3. sesion activa */}
      {sync.config && sync.session && (
        <div className="space-y-3">
          <p className="text-sm text-ink-2">
            {t('sync.signedInAs')} <span className="font-medium text-ink">{sync.session.email}</span>
          </p>
          <p className="text-xs text-muted">
            {t('sync.lastSync')}:{' '}
            <span className="tabular-nums">
              {sync.lastSyncAt ? fmtWhen(sync.lastSyncAt, lang) : t('sync.never')}
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={working} onClick={() => void sync.syncNow()}>
              {working ? t('sync.working') : t('sync.now')}
            </Button>
            <Button onClick={() => void sync.logOut()}>{t('sync.logOut')}</Button>
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-muted">{t('sync.help')}</p>
    </Card>
  )
}
