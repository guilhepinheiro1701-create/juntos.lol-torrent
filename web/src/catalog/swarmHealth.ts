import { useEffect, useState } from 'react'
import type { CatalogStream } from './streams'

/**
 * Seeds de AGORA, perguntados aos trackers pelo servidor (o navegador nao
 * fala UDP). O numero que o plugin mostra vem do indice dele e envelhece: um
 * torrent anunciado com 120 seeds pode ter 1 hoje.
 */
export interface SwarmCount { seeders: number; leechers: number }

export interface LiveSwarms {
  /** Ainda perguntando. */
  loading: boolean
  /** infoHash (minusculo) -> contagem; so o que algum tracker respondeu. */
  counts: Map<string, SwarmCount>
  /** Nenhum tracker respondeu: quase sempre firewall/antivirus no UDP do Docker. */
  unreachable: boolean
}

const EMPTY: LiveSwarms = { loading: false, counts: new Map(), unreachable: false }
// Todas (o servidor confere ate 300 em pacotes): uma fonte que fica sem
// conferencia nao pode ser comparada com as conferidas.
const MAX_HASHES = 300
const MAX_TRACKERS = 6

export function infoHashOf(stream: CatalogStream): string | null {
  return stream.location.kind === 'torrent' ? stream.location.infoHash.toLowerCase() : null
}

export async function fetchSwarmHealth(streams: CatalogStream[], signal?: AbortSignal): Promise<LiveSwarms> {
  const torrents = streams.filter((stream) => infoHashOf(stream) !== null)
  // As mais promissoras pelo numero do plugin primeiro: com muitas fontes, e
  // entre elas que a escolha acontece.
  const ordered = [...torrents].sort((a, b) => (b.seeders ?? 0) - (a.seeders ?? 0))
  const infoHashes = [...new Set(ordered.map((stream) => infoHashOf(stream) as string))].slice(0, MAX_HASHES)
  if (infoHashes.length === 0) return EMPTY
  const trackers = [...new Set(ordered.flatMap((stream) => (
    stream.location.kind === 'torrent' ? stream.location.trackers.filter((tracker) => tracker.startsWith('udp://')) : []
  )))].slice(0, MAX_TRACKERS)
  const response = await fetch('/api/torrents/health', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ infoHashes, trackers }),
    signal,
  })
  if (!response.ok) return EMPTY
  const body = await response.json() as { asked?: number; answered?: number; cached?: boolean; swarms?: Record<string, SwarmCount> }
  const counts = new Map<string, SwarmCount>()
  const answered = body.cached === true || (body.answered ?? 0) > 0
  if (answered) {
    for (const [hash, count] of Object.entries(body.swarms ?? {})) counts.set(hash.toLowerCase(), count)
  }
  return { loading: false, counts, unreachable: !answered && (body.asked ?? 0) > 0 }
}

export function useSwarmHealth(streams: CatalogStream[] | null): LiveSwarms {
  const [state, setState] = useState<LiveSwarms>(EMPTY)
  useEffect(() => {
    if (!streams || streams.length === 0) { setState(EMPTY); return }
    const abort = new AbortController()
    setState({ ...EMPTY, loading: true })
    fetchSwarmHealth(streams, abort.signal)
      .then((live) => { if (!abort.signal.aborted) setState(live) })
      .catch(() => { if (!abort.signal.aborted) setState(EMPTY) })
    return () => abort.abort()
  }, [streams])
  return state
}

/** Seeds verificados agora, se algum tracker respondeu por este torrent. */
export function liveSeeds(stream: CatalogStream, live: LiveSwarms | undefined): number | null {
  const hash = infoHashOf(stream)
  if (!hash || !live) return null
  const count = live.counts.get(hash)
  return count ? count.seeders : null
}
