/**
 * The way out of "unsupported media".
 *
 * A verdict with no evidence is not something a person can act on or report.
 * This gathers what actually decided it — the pipeline's own reason, the
 * codecs this browser will decode, the state of the room and its swarm — and
 * puts it on the clipboard in one press.
 */
import { useState } from 'react'
import { buildDiagnostics } from '../diagnostics'
import type { Translator } from '../i18n/useT'
import type { RoomInfo } from '../types'

type State = 'idle' | 'done' | 'failed'

/**
 * Copia o texto, pelo caminho moderno ou pelo antigo.
 *
 * `navigator.clipboard` so e oferecido em contexto seguro — HTTPS ou
 * localhost. Aberto pelo endereco da rede, que e como a TV e o outro
 * computador chegam aqui, ele nao existe, e o botao de copiar o relatorio de
 * erro falhava justamente onde alguem mais precisaria dele.
 */
async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText !== undefined) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {}

  // O jeito de antes da API: um campo fora da tela, selecionado e copiado.
  try {
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.cssText = 'position:fixed;top:-1000px;opacity:0'
    document.body.appendChild(field)
    field.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(field)
    if (ok) return true
  } catch {}

  console.error(text)
  return false
}

export function CopyErrorReport({ room, failure, detail, t }: {
  room: RoomInfo
  failure: string | null
  detail: string | null
  t: Translator
}) {
  const [state, setState] = useState<State>('idle')

  const copy = async () => {
    const report = await buildDiagnostics({ room, failure, detail })
    setState(await writeToClipboard(report) ? 'done' : 'failed')
    setTimeout(() => setState('idle'), 4000)
  }

  return (
    <div className="copy-report">
      <button type="button" className="ghost-button" onClick={() => { void copy() }}>
        {state === 'done' ? t('room.copyReportDone')
          : state === 'failed' ? t('room.copyReportFailed')
          : t('room.copyReport')}
      </button>
      <small>{t('room.copyReportHint')}</small>
    </div>
  )
}
