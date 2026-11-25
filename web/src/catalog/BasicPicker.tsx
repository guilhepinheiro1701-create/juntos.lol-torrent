import { useMemo, useState } from 'react'
import { Download, LoaderCircle, Play, ShieldAlert, Sparkles } from 'lucide-react'
import { availableLanguages, availableQualities, rankStreams, type LanguageChoice, type QualityChoice } from './autoPick'
import type { CatalogStream } from './streams'
import { liveSeeds, type LiveSwarms } from './swarmHealth'

type Translate = ((key: string) => string) & { language?: string }

const PREFS_KEY = 'ss.basic-prefs.v1'

function readPrefs(): { quality: QualityChoice; language: LanguageChoice } {
  try {
    const value = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as { quality?: QualityChoice; language?: LanguageChoice } | null
    return { quality: value?.quality ?? 'auto', language: value?.language ?? 'auto' }
  } catch {
    return { quality: 'auto', language: 'auto' }
  }
}

function savePrefs(quality: QualityChoice, language: LanguageChoice): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ quality, language })) } catch {}
}

interface BasicPickerProps {
  streams: CatalogStream[]
  /** Fontes em ordem de preferencia: a primeira toca, as outras sao o plano B. */
  onWatch: (ranked: CatalogStream[]) => void
  onDownload?: (best: CatalogStream) => void
  /** Seeds conferidos agora nos trackers (pelo servidor). */
  live?: LiveSwarms
  t: Translate
}

/**
 * O modo basico: duas perguntas (qualidade, idioma) e dois botoes (agora ou
 * offline). Qual torrent, de qual plugin, com quantos seeds — isso o site
 * resolve. A lista completa continua no modo avancado, nas configuracoes.
 */
export function BasicPicker({ streams, onWatch, onDownload, live, t }: BasicPickerProps) {
  const initial = useMemo(readPrefs, [])
  const qualities = useMemo(() => availableQualities(streams), [streams])
  const languages = useMemo(() => availableLanguages(streams), [streams])
  const [quality, setQuality] = useState<QualityChoice>(initial.quality)
  const [language, setLanguage] = useState<LanguageChoice>(initial.language)
  // Uma preferencia salva que este titulo nao tem vira "automatica" aqui, sem
  // apagar a preferencia para os proximos.
  const shownQuality: QualityChoice = quality !== 'auto' && !qualities.includes(quality) ? 'auto' : quality
  const shownLanguage: LanguageChoice = language !== 'auto' && !languages.includes(language) ? 'auto' : language
  const ranked = useMemo(
    () => rankStreams(streams, shownQuality, shownLanguage, t.language !== 'en', live),
    [streams, shownQuality, shownLanguage, t.language, live],
  )
  // Fontes conferidas com 0 ou 1 seed nao entram na fila de tentativas (cada
  // uma custava ate 45 s de espera para nada) - a nao ser que nao sobre
  // outra: ai vao as de 1 seed, e por ultimo todas.
  // Ordem da fila: vivas conferidas, depois as que ninguem conferiu, depois
  // as de 1 seed; as de 0 so se nao sobrar nada.
  const viable = useMemo(() => {
    const seedsOf = (stream: CatalogStream) => liveSeeds(stream, live)
    const alive = ranked.filter((stream) => (seedsOf(stream) ?? -1) >= 2)
    const unknown = ranked.filter((stream) => seedsOf(stream) === null)
    const weak = ranked.filter((stream) => seedsOf(stream) === 1)
    const queue = [...alive, ...unknown, ...weak]
    return queue.length > 0 ? queue : ranked
  }, [ranked, live])
  const best = viable[0]
  const bestLive = best ? liveSeeds(best, live) : null
  // Pediu dublado, mas nenhuma dublada esta viva: vai a outra, e diz.
  const dubSwapped = shownLanguage === 'dubbed' && !!best && !best.languages.includes('🇧🇷') && !live?.loading
  const allDead = live !== undefined && !live.loading && ranked.length > 0 && ranked.every((stream) => liveSeeds(stream, live) === 0)

  const chooseQuality = (value: QualityChoice) => { setQuality(value); savePrefs(value, language) }
  const chooseLanguage = (value: LanguageChoice) => { setLanguage(value); savePrefs(quality, value) }

  if (!best) return <p className="empty-copy">{t('basic.nothingPlayable')}</p>

  return (
    <div className="basic-picker">
      <div className="basic-field">
        <span className="basic-label">{t('details.quality')}</span>
        <div className="basic-chips" role="radiogroup" aria-label={t('details.quality')}>
          {(['auto', ...qualities] as QualityChoice[]).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={shownQuality === value}
              className={shownQuality === value ? 'is-on' : ''}
              onClick={() => chooseQuality(value)}
            >
              {value === 'auto' ? t('basic.auto') : value === '2160p' ? '4K' : value === 'sd' ? 'SD' : value}
            </button>
          ))}
        </div>
      </div>
      {languages.length > 1 ? (
        <div className="basic-field">
          <span className="basic-label">{t('details.language')}</span>
          <div className="basic-chips" role="radiogroup" aria-label={t('details.language')}>
            {(['auto', ...languages] as LanguageChoice[]).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={shownLanguage === value}
                className={shownLanguage === value ? 'is-on' : ''}
                onClick={() => chooseLanguage(value)}
              >
                {value === 'auto' ? t('basic.auto') : value === 'dubbed' ? t('basic.dubbed') : t('basic.original')}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <p className="basic-choice">
        {live?.loading ? <LoaderCircle size={14} className="spin" aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
        {live?.loading ? t('basic.checking') : t(bestLive !== null ? 'basic.chosenLive' : 'basic.chosen')
          .replace('{quality}', best.resolution === '2160p' ? '4K' : best.resolution === 'sd' ? 'SD' : best.resolution)
          .replace('{language}', best.languages.includes('🇧🇷') ? t('basic.dubbed') : t('basic.original'))
          .replace('{seeds}', String(bestLive ?? best.seeders ?? 0))}
      </p>
      {live?.unreachable ? (
        <p className="basic-warning" role="status">
          <ShieldAlert size={16} aria-hidden="true" />
          <span>{t('basic.trackersBlocked')}</span>
        </p>
      ) : dubSwapped ? (
        <p className="basic-warning" role="status">
          <ShieldAlert size={16} aria-hidden="true" />
          <span>{t('basic.noLiveDub')}</span>
        </p>
      ) : allDead ? (
        <p className="basic-warning" role="status">
          <ShieldAlert size={16} aria-hidden="true" />
          <span>{t('basic.allDead')}</span>
        </p>
      ) : null}
      <div className="basic-actions">
        <button type="button" className="basic-watch" onClick={() => onWatch(viable)}>
          <Play size={18} aria-hidden="true" />
          <span>
            <strong>{t('basic.watch')}</strong>
            <small>{t('basic.watchHint')}</small>
          </span>
        </button>
        {onDownload ? (
          <button type="button" className="basic-download" onClick={() => onDownload(best)}>
            <Download size={18} aria-hidden="true" />
            <span>
              <strong>{t('basic.download')}</strong>
              <small>{t('basic.downloadHint')}</small>
            </span>
          </button>
        ) : null}
      </div>
    </div>
  )
}
