import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// The service worker only checks for a new deploy when explicitly asked — without this,
// a PWA left open on the home screen can sit on stale code indefinitely. Checking on every
// launch/foreground means a normal close-and-reopen is enough to pick up updates.
if ('serviceWorker' in navigator) {
  const checkForUpdate = () => navigator.serviceWorker.getRegistration().then((reg) => reg?.update())
  window.addEventListener('load', checkForUpdate)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate()
  })
}
