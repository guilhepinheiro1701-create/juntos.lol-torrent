import { isPlayable, type CatalogStream, type StreamResolution } from './streams'

/**
 * A escolha automatica do modo basico.
 *
 * A pessoa diz a qualidade e o idioma; daqui sai a lista de fontes em ordem
 * de preferencia. A primeira e a que toca; as seguintes sao o plano B, usado
 * sozinho se a primeira nao responder (torrent sem seeds de verdade).
 */
export type QualityChoice = 'auto' | StreamResolution
export type LanguageChoice = 'auto' | 'dubbed' | 'original'

const PT = '🇧🇷'
/** Para assistir pela rede, 1080p e o ponto doce; 4K so quando pedido. */
const AUTO_ORDER: StreamResolution[] = ['1080p', '720p', '2160p', 'sd']
const RANK: Record<StreamResolution, number> = { '2160p': 3, '1080p': 2, '720p': 1, sd: 0 }

export function availableQualities(streams: CatalogStream[]): StreamResolution[] {
  const present = new Set(streams.filter(isPlayable).map((stream) => stream.resolution))
  return (['2160p', '1080p', '720p', 'sd'] as StreamResolution[]).filter((value) => present.has(value))
}

export function availableLanguages(streams: CatalogStream[]): LanguageChoice[] {
  const playable = streams.filter(isPlayable)
  const out: LanguageChoice[] = []
  if (playable.some((stream) => stream.languages.includes(PT))) out.push('dubbed')
  if (playable.some((stream) => !stream.languages.includes(PT))) out.push('original')
  return out
}

/** "2.3 GB" → bytes; sem tamanho, null. */
export function sizeBytes(size: string): number | null {
  const match = /([\d.,]+)\s*(TB|GB|MB|KB)/i.exec(size)
  if (!match) return null
  const value = Number(match[1].replace(',', '.'))
  if (!Number.isFinite(value)) return null
  const unit = match[2].toUpperCase()
  return value * (unit === 'TB' ? 1024 ** 4 : unit === 'GB' ? 1024 ** 3 : unit === 'MB' ? 1024 ** 2 : 1024)
}

function score(stream: CatalogStream, quality: QualityChoice, language: LanguageChoice, preferPortuguese: boolean): number {
  // Seeds mandam: e o que decide se o filme abre e se chega rapido. Em log,
  // para 500 contra 400 nao valer mais que acertar a qualidade pedida.
  // Satura em ~64 seeds: daí para cima o torrent ja abre e flui, e 400
  // contra 120 nao deve valer mais que a qualidade ou o idioma pedidos.
  const seeds = stream.seeders ?? 0
  let value = Math.min(Math.log2(seeds + 1), 6) * 10
  if (seeds === 0) value -= 40

  const wanted = quality === 'auto' ? null : quality
  if (wanted) {
    value -= Math.abs(RANK[stream.resolution] - RANK[wanted]) * 25
  } else {
    value -= AUTO_ORDER.indexOf(stream.resolution) * 8
  }

  const dubbed = stream.languages.includes(PT)
  if (language === 'dubbed') value += dubbed ? 30 : -30
  else if (language === 'original') value += dubbed ? -30 : 10
  else if (dubbed) value += preferPortuguese ? 12 : -6

  // Arquivos enormes demoram a comecar e enchem o disco; um 1080p de 40 GB
  // (remux) perde para um de 4 GB com seeds parecidos.
  const bytes = sizeBytes(stream.size)
  if (bytes !== null && bytes > 20 * 1024 ** 3) value -= 12
  return value
}

export function rankStreams(
  streams: CatalogStream[],
  quality: QualityChoice,
  language: LanguageChoice,
  preferPortuguese = true,
): CatalogStream[] {
  return streams
    .filter(isPlayable)
    .map((stream, index) => ({ stream, index, value: score(stream, quality, language, preferPortuguese) }))
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .map((entry) => entry.stream)
}
