import { useEffect, useState } from 'react'

/**
 * Configuracoes deste navegador.
 *
 * "Escolha de fontes":
 *  - basica: a pessoa diz so como quer (agora ou offline, qualidade, idioma)
 *    e o site escolhe a melhor fonte sozinho; o carregamento e uma barra.
 *  - avancada: a lista completa de fontes, como sempre foi.
 */
export type SourceMode = 'basic' | 'advanced'

const KEY = 'ss.source-mode'
const EVENT = 'ss-settings'

export function sourceMode(): SourceMode {
  try {
    return localStorage.getItem(KEY) === 'advanced' ? 'advanced' : 'basic'
  } catch {
    return 'basic'
  }
}

export function setSourceMode(mode: SourceMode): void {
  try { localStorage.setItem(KEY, mode) } catch {}
  try { window.dispatchEvent(new Event(EVENT)) } catch {}
}

export function useSourceMode(): SourceMode {
  const [mode, setMode] = useState(sourceMode)
  useEffect(() => {
    const read = () => setMode(sourceMode())
    window.addEventListener(EVENT, read)
    window.addEventListener('storage', read)
    return () => {
      window.removeEventListener(EVENT, read)
      window.removeEventListener('storage', read)
    }
  }, [])
  return mode
}
