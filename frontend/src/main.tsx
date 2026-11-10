import React, { Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
// fonts are bundled (SIL OFL) so the HUD works offline
import '@fontsource/rajdhani/500.css'
import '@fontsource/rajdhani/600.css'
import '@fontsource/rajdhani/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/600.css'
import './ui/styles.css'

// ?preview=<name> renders src/preview/<Name>Preview.tsx (dev asset previews).
const previews = import.meta.glob('./preview/*Preview.tsx')
const params = new URLSearchParams(location.search)
const previewName = params.get('preview')

function pick() {
  if (previewName) {
    const key = Object.keys(previews).find((k) => k.toLowerCase().includes(`/${previewName.toLowerCase()}preview`))
    if (key) return lazy(previews[key] as any)
  }
  return lazy(() => import('./App'))
}
const Root = pick()

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={<div className="boot">INITIALISING IMPERIAL NETWORK…</div>}>
      <Root />
    </Suspense>
  </React.StrictMode>,
)
