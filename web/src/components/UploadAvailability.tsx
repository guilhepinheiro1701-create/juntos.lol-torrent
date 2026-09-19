import { useEffect, useRef, useState } from 'react'
import type { Translator } from '../i18n/useT'
import type { RoomPreparation } from '../types'
import type { RoomUploadProgress } from '../upload'
import type { TorrentStats } from '../torrent'
import { TorrentReadout } from './TorrentReadout'
import { SlotText } from '../ui/SlotText'
import NumberFlow from '@number-flow/react'
import { numbersAnimate } from '../engine'
import { GATE_OPEN_SEC } from '../player/gate'

/** What the player under the card is waiting on, once the room has media. */
export interface OpeningWait {
  secondsLeft: number | null
  cold: boolean
}

const RATE_WINDOW_MS = 20_000

const MIN_USEFUL_BYTES_PER_SECOND = 16 * 1024

function formatDuration(seconds: number, t: Translator): string {
  if (seconds < 60) return t('prep.etaUnderAMinute')
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return t('prep.etaMinutes').replace('{n}', String(minutes))
  const hours = Math.round(seconds / 3600)
  return t('prep.etaHours').replace('{n}', String(hours))
}

function useTransferRate(receivedBytes: number): number {
  const samples = useRef<{ at: number; bytes: number }[]>([])
  const [rate, setRate] = useState(0)

  useEffect(() => {
    const now = Date.now()
    const history = samples.current
    if (history.length > 0 && receivedBytes < history[history.length - 1].bytes) history.length = 0
    history.push({ at: now, bytes: receivedBytes })
    while (history.length > 2 && now - history[0].at > RATE_WINDOW_MS) history.shift()

    const oldest = history[0]
    const elapsed = (now - oldest.at) / 1000
    setRate(elapsed >= 1 ? (receivedBytes - oldest.bytes) / elapsed : 0)
  }, [receivedBytes])

  return rate
}

// The byte count playback can begin at, which is the end of the transfer only
// for a source that cannot be previewed at all.
function waitTarget(preparation: RoomPreparation): { bytes: number; certain: boolean } {
  if (preparation.previewPhase === 'unavailable') {
    return { bytes: preparation.sourceBytes ?? 0, certain: true }
  }
  return { bytes: preparation.previewTargetBytes ?? 0, certain: false }
}

function phaseKey(preparation: RoomPreparation): string {
  switch (preparation.previewPhase) {
    case 'unavailable': return 'prep.phaseUnavailable'
    case 'segmenting': return 'prep.phaseSegmenting'
    case 'probing': return 'prep.phaseProbing'
    default: return 'prep.phaseReceiving'
  }
}

/**
 * O quanto do torrent já chegou, e em quanto tempo o resto chega.
 *
 * O tamanho total não vem nas estatísticas do enxame, mas sai da divisão: o
 * que já foi baixado sobre a fração que isso representa. Com a fração ainda
 * em zero não há conta a fazer, e não há o que mostrar.
 */
function swarmProgress(swarm: TorrentStats | null | undefined): { pct: number; eta: number | null; verifying: boolean } | null {
  if (!swarm) return null

  const total = swarm.progress > 0 ? swarm.downloaded / swarm.progress : 0

  // Reabrir um filme que já está no disco cria um trabalho novo, e o baixador
  // recomeça do zero na contagem: ele só chama de "tem" o pedaço que já
  // conferiu. Nessa hora o que existe de verdade está em `diskBytes`, a
  // velocidade é zero porque não há nada a baixar, e um "calculando…" eterno
  // seria a pior leitura possível de um filme que já está inteiro ali.
  const onDisk = swarm.diskBytes ?? 0
  const verifying = total > 0 && swarm.downloadSpeed === 0 && onDisk >= total * 0.98 && swarm.downloaded < total * 0.98
  if (verifying) return { pct: Math.min(100, Math.round(swarm.progress * 100)), eta: null, verifying: true }

  if (swarm.progress <= 0 || swarm.downloaded <= 0) return null
  const pct = Math.min(100, Math.round(swarm.progress * 100))
  const remaining = Math.max(0, total - swarm.downloaded)
  const eta = swarm.downloadSpeed >= MIN_USEFUL_BYTES_PER_SECOND && remaining > 0
    ? remaining / swarm.downloadSpeed
    : null
  return { pct, eta, verifying: false }
}

export function UploadAvailability({
  progress,
  preparation,
  swarm,
  wait,
  t,
}: {
  progress: RoomUploadProgress | null
  preparation?: RoomPreparation | null
  swarm?: TorrentStats | null
  wait?: OpeningWait | null
  t: Translator
}) {
  const received = preparation?.receivedBytes ?? progress?.bytesUploaded ?? 0
  const total = preparation?.sourceBytes ?? progress?.bytesTotal ?? 0
  const rate = useTransferRate(received)

  const prep: RoomPreparation = preparation ?? {}
  const target = waitTarget(prep)

  const barTotal = target.bytes > 0 ? target.bytes : total
  const barPct = barTotal > 0 ? Math.min(100, Math.round((received / barTotal) * 100)) : 0

  const remaining = Math.max(0, barTotal - received)
  const eta = rate >= MIN_USEFUL_BYTES_PER_SECOND && remaining > 0 ? remaining / rate : null

  const started = received > 0 || total > 0

  // Enquanto o preparo não recebeu byte nenhum, quem está andando é o torrent.
  //
  // A condição é `received === 0`, e não `!started`: o tamanho do arquivo é
  // conhecido desde o primeiro instante, então `started` já nasce verdadeiro
  // num torrent e este trecho nunca rodava. A barra ficava parada em zero e o
  // tempo dizia "calculando…" enquanto o filme baixava logo abaixo, no mesmo
  // cartão — que é exatamente o que fazia esperar sem saber até quando.
  const fetch = swarmProgress(swarm)
  const usingSwarm = received === 0 && fetch !== null

  const label = usingSwarm
    ? t(fetch.verifying ? 'prep.phaseVerifying' : 'prep.phaseFetching')
    : !started
      ? t('room.waitingInitial')
      : barPct >= 100 && prep.previewPhase !== 'unavailable'
        ? t('prep.phaseSegmenting')
        : t(phaseKey(prep))

  const shownEta = usingSwarm ? fetch.eta : eta
  const etaLabel = shownEta !== null
    ? formatDuration(shownEta, t)
    : usingSwarm && fetch.verifying ? t('prep.etaVerifying')
      : (usingSwarm ? fetch.pct : barPct) >= 100 ? t('prep.etaAlmost') : t('prep.etaUnknown')

  const buffering = wait !== null && wait !== undefined
  const bufferLeft = buffering && !wait.cold ? wait.secondsLeft : null
  const bufferPct = bufferLeft === null ? 0 : Math.max(0, Math.min(100, Math.round((1 - bufferLeft / GATE_OPEN_SEC) * 100)))
  const stageKey = !buffering ? label : wait.cold ? 'cold' : 'buffer'
  const shownPct = buffering ? bufferPct : usingSwarm ? fetch.pct : barPct

  return (
    <div className="availability-card">
      <h1>{t('room.processing')}</h1>
      <p>
        <SlotText k={stageKey} block>
          {!buffering ? label : wait.cold ? t('room.preparingPart') : (
            <span className="text-shimmer">{t('room.bufferingLead')}</span>
          )}
        </SlotText>
      </p>
      <div className="availability-meter">
        <div
          className={`prep-bar ${shownPct > 0 ? 'is-progress' : 'is-indeterminate'}`}
          role="progressbar"
          aria-label={t('prep.untilPlayable')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={shownPct}
        >
          <span style={shownPct > 0 ? { width: `${shownPct}%` } : undefined} />
        </div>
        <div className="prep-eta">
          <span>
            {buffering || (target.bytes > 0 && !target.certain) ? t('prep.untilPlayable') : t('prep.untilComplete')}
            {shownPct > 0 ? <em className="prep-pct"><NumberFlow animated={numbersAnimate} value={shownPct} suffix="%" /></em> : null}
          </span>
          {buffering
            ? <strong>{bufferLeft !== null ? <NumberFlow animated={numbersAnimate} value={bufferLeft} suffix={t('room.bufferingTail')} /> : t('prep.etaUnknown')}</strong>
            : <strong>{etaLabel}</strong>}
        </div>
      </div>
      {swarm ? <TorrentReadout stats={swarm} /> : null}
    </div>
  )
}
