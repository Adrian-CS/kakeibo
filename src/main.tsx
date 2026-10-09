import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

const el = document.getElementById('root')
if (el) {
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

/*
 * Pedir almacenamiento persistente: sin esto el navegador puede borrar los
 * datos del sitio cuando anda justo de espacio (y Safari los tira solos a las
 * semanas sin abrir la app). Se pide una vez; si dice que no, no pasa nada
 * mas que seguir como hasta ahora.
 */
void navigator.storage?.persist?.().catch(() => {
  /* no todos los navegadores lo tienen, y alguno lo deniega sin mas */
})

// service worker: la app queda disponible sin conexion tras la primera visita
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* sin service worker la app sigue funcionando, solo pierde el modo offline */
    })
  })
}
