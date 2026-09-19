import { mockOpenTorrent, mocksEnabled } from './mocks'
import { openRemoteTorrent, UnknownStorageError, type OpenTorrentOptions } from './remoteTorrent'
import { setStoragePreference, storagePreference } from './storagePlace'

export { NoWorkersError, TorrentQuotaError, TorrentRejectedError, WorkersBusyError, parseMagnet, probeWorkers } from './remoteTorrent'
export type { OpenTorrentOptions, WorkerProbe } from './remoteTorrent'

/** Where a worker serves a selected file from, with the ticket that rotates. */
export interface WorkerGrant {
  jobId: string
  readBase: string
  ticket: string
  expiresAt: string
  name: string
  size: number
  fileIndex: number
}

export interface TorrentVideoFile {
  name: string
  path: string
  index: number
  size: number
  type: string
  progress: number
  downloaded: number
  worker?: WorkerGrant
}

// A small non-video file shipped in the same torrent.
export interface TorrentSideFile {
  name: string
  path: string
  size: number
  index?: number
}

export interface TorrentStats {
  peers: number
  downloadSpeed: number
  downloaded: number
  progress: number
  diskBytes?: number
}

export interface TorrentSession {
  name: string
  magnet?: string
  jobId?: string
  files: TorrentVideoFile[]
  subtitleFiles: TorrentSideFile[]
  stats(): TorrentStats
  select(path: string): Promise<void>
  destroy(): void
  /** Stops this tab's polling without releasing the server-side job: the
   * room's production runs on the worker and still needs it. */
  detach?(): void
}

/**
 * Places the magnet on a worker; nothing is downloaded on this machine. The
 * error type says whether the failure is worth retrying.
 */
export async function openTorrent(
  magnet: string,
  onStats?: (stats: TorrentStats) => void,
  options?: OpenTorrentOptions,
): Promise<TorrentSession> {
  if (mocksEnabled) return mockOpenTorrent(onStats)
  // The disk preference is read here rather than threaded through every
  // caller: it is the same answer for all of them, and this is the one door
  // they all go through.
  const storage = options?.storage ?? storagePreference()
  try {
    return await openRemoteTorrent(magnet, onStats, { ...options, ...(storage ? { storage } : {}) })
  } catch (error) {
    // O disco escolhido deixou de existir — alguem rodou o pasta.bat, ou
    // editou o .env.local. Insistir nele e um beco sem saida: a preferencia
    // cai, e a tentativa seguinte usa o lugar padrao do worker. Uma vez so,
    // para nao entrar em ciclo se o padrao tambem for recusado.
    if (!(error instanceof UnknownStorageError) || !storage) throw error
    setStoragePreference('')
    return await openRemoteTorrent(magnet, onStats, { ...options, storage: undefined })
  }
}
