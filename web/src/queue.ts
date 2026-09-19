import { keepTorrent, parseMagnet } from './remoteTorrent'
import { openTorrent, type TorrentSession, type TorrentVideoFile } from './torrent'
import { queueKey, remember } from './library'

/**
 * Baixar um filme sem abrir o player.
 *
 * O worker ja fazia isto: um torrent marcado para ficar nunca e pausado nem
 * recolhido (`reclaimable() = leases.is_empty() && !self.keep`), entao ele
 * segue baixando com ninguem olhando. O que faltava era o site saber pedir
 * assim — antes era preciso entrar na sala e ficar la, com o filme tocando,
 * so para que o download acontecesse.
 *
 * O que fazemos aqui, na ordem: abrir o torrent, escolher o arquivo de video,
 * marcar para ficar, anotar na biblioteca e soltar. `detach` e nao `destroy`:
 * o primeiro so para de perguntar desta aba; o segundo devolveria o trabalho
 * ao worker, que e o oposto do que se quer.
 */
export interface QueueRequest {
  magnet: string
  /** O nome do filme no catalogo, quando veio de la. */
  title?: string
  poster?: string
  /** Qual arquivo, quando quem chama ja escolheu. */
  filePath?: string
}

export class NoVideoInTorrentError extends Error {
  constructor() {
    super('the torrent holds no file we can play')
    this.name = 'NoVideoInTorrentError'
  }
}

export interface QueueDeps {
  open?: typeof openTorrent
  keep?: typeof keepTorrent
  save?: typeof remember
}

export interface Queued {
  roomId: string
  jobId: string
  fileName: string
}

export async function queueDownload(request: QueueRequest, deps: QueueDeps = {}): Promise<Queued> {
  const open = deps.open ?? openTorrent
  const keep = deps.keep ?? keepTorrent
  const save = deps.save ?? remember

  const parsed = parseMagnet(request.magnet)
  if (!parsed) throw new Error('queue: magnet without an infohash')

  const session = await open(request.magnet)
  let file: TorrentVideoFile | undefined
  try {
    file = pick(session, request.filePath)
    if (!file) throw new NoVideoInTorrentError()
    await session.select(file.path)
    // Sem isto o worker pausa o torrent dois minutos depois de a aba parar de
    // pedir bytes, e o download de segundo plano dura dois minutos.
    if (session.jobId) await keep(session.jobId, true)
  } catch (error) {
    session.destroy()
    throw error
  }

  const entry: Queued = {
    roomId: queueKey(parsed.infoHash),
    jobId: session.jobId ?? '',
    fileName: file.name,
  }
  save({
    roomId: entry.roomId,
    jobId: entry.jobId,
    fileName: entry.fileName,
    title: request.title,
    poster: request.poster,
    magnet: request.magnet,
    filePath: file.path,
  })

  // Sai de fininho: o trabalho continua no worker, e esta aba para de olhar.
  session.detach?.()
  return entry
}

function pick(session: TorrentSession, filePath?: string): TorrentVideoFile | undefined {
  if (filePath) {
    const exact = session.files.find((candidate) => candidate.path === filePath)
    if (exact) return exact
  }
  // O maior arquivo de video e o filme; os outros sao extras e trailers.
  return [...session.files].sort((a, b) => b.size - a.size)[0]
}
