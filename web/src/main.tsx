import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './tailwind.css'
import './theme.css'
import App from './App.tsx'
import { ToastProvider } from './ui/Toast'
import { installMockApi } from './mocks'
import { markEngine } from './engine'
import { registerYoutubeBackend } from './youtube'
import { jlocalBackend } from './jlocal/youtube'

markEngine()
installMockApi()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
)

registerYoutubeBackend(jlocalBackend)

// O plugin que vem com o site entra antes de qualquer ida a rede: e o que faz
// o catalogo achar fontes num navegador que nunca instalou nada — a TV da
// sala, o computador do quarto.
void import('./plugins/builtin')
  .then(({ ensureBuiltin }) => ensureBuiltin())
  .catch((error) => console.error('builtin plugin failed', error))

const checkPlugins = () => { void import('./plugins/update').then(({ updateAll }) => updateAll()).catch(() => undefined) }
const idle = window.requestIdleCallback
if (typeof idle === 'function') idle(checkPlugins, { timeout: 3_000 })
else window.setTimeout(checkPlugins, 1_500)
