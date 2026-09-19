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

// Um download que o worker perdeu ao reiniciar volta a andar assim que o site
// abre — sem depender de a aba Baixados estar aberta, que seria pedir que a
// pessoa soubesse onde procurar o que ela nem sabe que parou.
const resumeDownloads = () => {
  void import('./queue')
    .then(({ resumeInterrupted }) => resumeInterrupted())
    .catch((error) => console.error('resuming downloads failed', error))
}

const checkPlugins = () => { void import('./plugins/update').then(({ updateAll }) => updateAll()).catch(() => undefined) }
const idle = window.requestIdleCallback
const later = (task: () => void) => {
  if (typeof idle === 'function') idle(task, { timeout: 3_000 })
  else window.setTimeout(task, 1_500)
}
later(checkPlugins)
later(resumeDownloads)
