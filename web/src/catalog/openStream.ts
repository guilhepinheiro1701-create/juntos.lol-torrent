import { openTorrent, type TorrentSession, type TorrentVideoFile } from '../torrent'
import { TorrentRejectedError } from '../remoteTorrent'
import { buildMagnet, type CatalogStream, type StreamLocation, type StreamTarget } from './streams'

type TorrentLocation = Extract<StreamLocation, { kind: 'torrent' }>

const basename = (path: string): string => path.split('/').pop() ?? path

/**
 * Matches one episode inside a season pack, across `S01E02`, `s1.e2` and
 * `1x02` spellings; the trailing guard keeps episode 1 from matching `E11`.
 */
export function episodePattern(season: number, episode: number): RegExp {
  const s = `0*${season}`
  const e = `0*${episode}`
  return new RegExp(`(?:s${s}[\\s._-]*(?:e|ep)${e}|(?<![\\d])${s}x${e})(?![\\d])`, 'i')
}

/**
 * The addon's filename hint wins; its `fileIdx` is believed last, because it is
 * 0 on most season packs. Falls back to the largest file.
 */
/** Algum SxxEyy / 1x02 no nome: o arquivo diz qual episodio e. */
const ANY_EPISODE = /(?:s\d{1,2}[\s._-]*(?:e|ep)\d{1,3}|(?<!\d)\d{1,2}x\d{2,3})(?!\d)/i

/**
 * Num episodio pedido, um torrent cujos arquivos dizem ser OUTROS episodios
 * (pacote de outra temporada, episodio vizinho) nao serve: tocar o primeiro
 * arquivo era tocar o episodio errado sem avisar. Arquivos sem SxxEyy no nome
 * passam (filmes, releases sem marcacao).
 */
export function wrongEpisode(files: TorrentVideoFile[], location: TorrentLocation, target?: StreamTarget): boolean {
  if (target?.season == null || target?.episode == null) return false
  const pattern = episodePattern(target.season, target.episode)
  if (location.fileName && pattern.test(basename(location.fileName))) {
    const wanted = basename(location.fileName).toLowerCase()
    if (files.some((file) => basename(file.path).toLowerCase() === wanted)) return false
  }
  if (files.some((file) => pattern.test(file.path))) return false
  return files.length > 0 && files.every((file) => ANY_EPISODE.test(basename(file.path)))
}

export function pickStreamFile(
  files: TorrentVideoFile[],
  location: TorrentLocation,
  target?: StreamTarget,
): TorrentVideoFile | undefined {
  if (wrongEpisode(files, location, target)) return undefined
  if (files.length <= 1) return files[0]

  if (location.fileName) {
    const wanted = basename(location.fileName).toLowerCase()
    const byName = files.find((file) => basename(file.path).toLowerCase() === wanted)
    if (byName) return byName
  }

  if (target?.season != null && target?.episode != null) {
    const pattern = episodePattern(target.season, target.episode)
    const matches = files.filter((file) => pattern.test(file.path))
    if (matches.length) return matches.reduce((best, file) => (file.size > best.size ? file : best))
  }

  if (location.fileIdx !== null) {
    const byIdx = files.find((file) => file.index === location.fileIdx)
    if (byIdx) return byIdx
  }

  return files[0]
}

/** Opens the stream's torrent and selects the single file it means, so a pack never downloads whole. */
export async function openCatalogStream(
  stream: CatalogStream,
  target?: StreamTarget,
  onStats?: Parameters<typeof openTorrent>[1],
  options?: Parameters<typeof openTorrent>[2],
): Promise<{ file: TorrentVideoFile; session: TorrentSession }> {
  const { location } = stream
  if (location.kind !== 'torrent') throw new Error('openCatalogStream expects a torrent stream')
  const session = await openTorrent(buildMagnet(location, stream.label), onStats, options)
  const file = pickStreamFile(session.files, location, target)
  if (!file) {
    session.destroy()
    // Erros de torrent, nao genericos: a fila de fontes passa para a proxima.
    throw new TorrentRejectedError(wrongEpisode(session.files, location, target) ? 'episode_missing' : 'not_video')
  }
  try {
    await session.select(file.path)
  } catch (error) {
    session.destroy()
    throw error
  }
  return { file, session }
}
