import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { parseAuthHash, saveSession, sessionFromTokens } from './lib/supabase'
import './index.css'

/**
 * Si venimos del enlace del correo, la URL trae los tokens en el hash. Hay que
 * recogerlos y limpiar la direccion ANTES de montar la app, porque el hash es
 * tambien donde vive la navegacion (#/month/2026-08).
 */
function consumeAuthHash(): void {
  const parsed = parseAuthHash(window.location.hash)
  if (!parsed) return
  try {
    if (parsed.error) {
      sessionStorage.setItem('kakeibo:authError', parsed.error)
    } else if (parsed.accessToken && parsed.refreshToken) {
      saveSession(
        sessionFromTokens({
          access_token: parsed.accessToken,
          refresh_token: parsed.refreshToken,
          expires_in: parsed.expiresIn,
        }),
      )
    }
  } catch {
    /* sin almacenamiento no hay sesion que guardar */
  }
  window.history.replaceState(null, '', `${window.location.pathname}#/settings`)
}

consumeAuthHash()

const el = document.getElementById('root')
if (el) {
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

// service worker: la app queda disponible sin conexion tras la primera visita
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* sin service worker la app sigue funcionando, solo pierde el modo offline */
    })
  })
}
