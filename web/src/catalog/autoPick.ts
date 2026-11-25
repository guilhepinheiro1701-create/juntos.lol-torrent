import { isPlayable, type CatalogStream, type StreamResolution } from './streams'
import { liveSeeds, type LiveSwarms } from './swarmHealth'

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

function score(stream: CatalogStream, quality: QualityChoice, language: LanguageChoice, preferPortuguese: boolean, live?: LiveSwarms): number {
  // Seeds mandam: e o que decide se o filme abre e se chega rapido. Em log e
  // saturando em ~64: dai para cima o torrent ja abre e flui, e 400 contra
  // 120 nao deve valer mais que acertar a qualidade ou o idioma pedidos.
  // O numero conferido agora nos trackers vale mais que o do plugin, que
  // envelhece; um torrent conferido sem seed nenhum vai para o fim da fila.
  const verified = liveSeeds(stream, live)
  const seeds = verified ?? stream.seeders ?? 0
  let value = Math.min(Math.log2(seeds + 1), 6) * 10
  if (verified === 0) value -= 120
  // Um seed so, conferido agora, quase nunca abre: o diagnostico mostrou
  // varios assim sem um peer sequer aceitando conexao. Fica atras de uma
  // fonte viva mesmo de outro idioma, e a tela avisa da troca.
  else if (verified === 1) value -= 70
  else if (seeds === 0) value -= 40
  else if (verified !== null) value += 5

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
  live?: LiveSwarms,
): CatalogStream[] {
  return streams
    .filter(isPlayable)
    .map((stream, index) => ({ stream, index, value: score(stream, quality, language, preferPortuguese, live) }))
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .map((entry) => entry.stream)
}
