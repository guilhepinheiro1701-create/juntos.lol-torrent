import { useCallback, useEffect, useRef, useState } from 'react'
import { Film, Play, Trash2 } from 'lucide-react'
import type { Translator } from '../i18n/useT'
import { forget, library, type LibraryEntry } from '../library'
import { openTorrent } from '../torrent'
import { createRoomAndUploadTorrent } from '../upload'
import { jobProgress, keepTorrent, type JobProgress } from '../remoteTorrent'
import { useToast } from '../ui/toastContext'
import { StoragePicker } from './StoragePicker'

const POLL_MS = 3000

function gigabytes(bytes: number): string {
  return `${(bytes / 1_073_741_824).toFixed(bytes < 1_073_741_824 ? 2 : 1)} GB`
}

/**
 * What this browser has kept on disk, and the way back into it.
 *
 * Reopening does not resurrect the old job: it creates a new one from the
 * magnet the library kept. The worker already holds the bytes, so there is
 * nothing to download again — which is also why a job expiring with its
 * browser session costs nothing here. The file is what matters, and the
 * magnet is what finds it.
 *
 * This is the one screen that works with no network at all: the catalogue
 * needs an addon and a metadata service, and this needs neither.
 */
export function LibraryShelf({ t, onOpened }: {
  t: Translator
  onOpened: (roomId: string) => void
}) {
  const { toast } = useToast()
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [opening, setOpening] = useState('')

  const refresh = useCallback(() => setEntries(library()), [])
  useEffect(refresh, [refresh])

  // Um download que ainda esta andando nao tem por que parecer pronto. Enquanto
  // houver algum incompleto, perguntamos ao worker de tres em tres segundos; no
  // instante em que todos chegarem ao fim, paramos de perguntar.
  const [progress, setProgress] = useState<Record<string, JobProgress>>({})
  const jobIds = entries.map((entry) => entry.jobId).join(',')
  const stop = useRef(false)
  useEffect(() => {
    if (jobIds === '') return
    stop.current = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const look = async () => {
      const ids = jobIds.split(',')
      const answers = await Promise.all(ids.map((id) => jobProgress(id)))
      if (stop.current) return
      const next: Record<string, JobProgress> = {}
      ids.forEach((id, n) => { const answer = answers[n]; if (answer) next[id] = answer })
      setProgress(next)
      const done = Object.values(next).every((one) => one.progress !== null && one.progress >= 1)
      if (!done) timer = setTimeout(() => { void look() }, POLL_MS)
    }
    void look()
    return () => {
      stop.current = true
      if (timer !== null) clearTimeout(timer)
    }
  }, [jobIds])

  const open = async (entry: LibraryEntry) => {
    if (!entry.magnet) {
      toast(t('library.noMagnet'))
      return
    }
    setOpening(entry.roomId)
    try {
      const session = await openTorrent(entry.magnet)
      const file = session.files.find((candidate) => candidate.path === entry.filePath)
        ?? session.files[0]
      if (!file) {
        session.destroy()
        throw new Error('the torrent holds no file we can play')
      }
      await session.select(file.path)
      const room = await createRoomAndUploadTorrent({ file, session }, '')
      // The new job needs the mark too; the worker keeps the bytes either way,
      // but a job that does not carry it is one the reaper may come back for.
      if (session.jobId) await keepTorrent(session.jobId, true).catch(() => undefined)
      onOpened(room.roomID)
    } catch (error) {
      console.error('reopening a download failed', error)
      toast(t('library.openFailed'))
      setOpening('')
    }
  }

  const drop = async (entry: LibraryEntry) => {
    // The space goes back only if the worker still knows the job; either way
    // the record goes, because this is the viewer saying they are done with it.
    await keepTorrent(entry.jobId, false).catch(() => undefined)
    forget(entry.roomId)
    refresh()
    toast(t('library.dropped'))
  }

  if (entries.length === 0) {
    return (
      <div className="library-empty">
        <h2>{t('library.emptyTitle')}</h2>
        <p>{t('library.emptyGuide')}</p>
        <StoragePicker t={t} />
      </div>
    )
  }

  // Baixando primeiro, prontos depois: quem acabou de por um filme na fila
  // abre esta aba para ver aquele, e nao para procurá-lo no meio dos outros.
  // Sem resposta do worker ainda, o filme fica entre os prontos — e onde ele
  // estava antes de existir fila, e chutar "baixando" seria pior.
  const baixando = entries.filter((entry) => {
    const at = progress[entry.jobId]
    return at !== undefined && at.progress !== null && at.progress < 1
  })
  const prontos = entries.filter((entry) => !baixando.includes(entry))

  const cartao = (entry: LibraryEntry) => (
    <li key={entry.roomId} className="library-card">
            {entry.poster
              ? <img className="library-poster" src={entry.poster} alt="" loading="lazy" />
              : (
                <span className="library-poster is-blank" aria-hidden="true">
                  <Film size={22} />
                </span>
              )}
            <div className="library-body">
              <span className="library-name" title={entry.title || entry.fileName}>
                {entry.title || entry.fileName}
              </span>
              {entry.title ? <span className="library-file">{entry.fileName}</span> : null}
              <LibraryProgress entry={entry} at={progress[entry.jobId]} t={t} />
            </div>
            <div className="library-actions">
              <button
                type="button"
                className="primary-button"
                disabled={opening !== ''}
                onClick={() => { void open(entry) }}
              >
                <Play size={15} aria-hidden="true" />
                {t(opening === entry.roomId ? 'library.opening' : 'library.play')}
              </button>
              <button
                type="button"
                className="secondary-button"
                aria-label={t('library.drop')}
                disabled={opening !== ''}
                onClick={() => { void drop(entry) }}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </div>
          </li>
  )

  return (
    <div className="library-shelf">
      <h2>{t('library.title')}</h2>
      <StoragePicker t={t} />
      {baixando.length > 0 ? (
        <section className="library-group">
          <h3>{t('library.queue')}<em>{baixando.length}</em></h3>
          <ul className="library-list">{baixando.map(cartao)}</ul>
        </section>
      ) : null}
      {prontos.length > 0 ? (
        <section className="library-group">
          {baixando.length > 0 ? <h3>{t('library.done')}</h3> : null}
          <ul className="library-list">{prontos.map(cartao)}</ul>
        </section>
      ) : null}
    </div>
  )
}

/**
 * A linha de baixo de cada cartao: quanto ja chegou, ou o tamanho no disco
 * quando acabou. Sem resposta do worker ela nao aparece — dizer "0%" quando na
 * verdade nao se sabe e pior que nao dizer nada.
 */
function LibraryProgress({ entry, at, t }: { entry: LibraryEntry; at?: JobProgress; t: Translator }) {
  if (!at) return <span className="library-line is-quiet">{t('library.checking')}</span>
  if (at.progress === null) return <span className="library-line is-quiet">{t('library.checking')}</span>

  const pct = Math.round(at.progress * 100)
  if (pct >= 100) {
    return (
      <span className="library-line is-done">
        {t('library.complete')}
        {at.totalBytes > 0 ? <em>{gigabytes(at.totalBytes)}</em> : null}
      </span>
    )
  }
  return (
    <span className="library-line">
      <span
        className="library-bar"
        role="progressbar"
        aria-label={entry.title || entry.fileName}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <span style={{ width: `${pct}%` }} />
      </span>
      <em>{pct}%</em>
      {at.totalBytes > 0 ? <em className="is-quiet">{gigabytes(at.haveBytes)} / {gigabytes(at.totalBytes)}</em> : null}
    </span>
  )
}
