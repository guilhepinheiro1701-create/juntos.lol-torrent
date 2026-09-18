import { useCallback, useEffect, useState } from 'react'
import { Play, Trash2 } from 'lucide-react'
import type { Translator } from '../i18n/useT'
import { forget, library, type LibraryEntry } from '../library'
import { openTorrent } from '../torrent'
import { createRoomAndUploadTorrent } from '../upload'
import { keepTorrent } from '../remoteTorrent'
import { useToast } from '../ui/toastContext'
import { StoragePicker } from './StoragePicker'

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

  return (
    <div className="library-shelf">
      <h2>{t('library.title')}</h2>
      <StoragePicker t={t} />
      <ul className="library-list">
        {entries.map((entry) => (
          <li key={entry.roomId} className="library-card">
            {entry.poster
              ? <img className="library-poster" src={entry.poster} alt="" />
              : <span className="library-poster is-blank" aria-hidden="true" />}
            <span className="library-name">{entry.title || entry.fileName}</span>
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
        ))}
      </ul>
    </div>
  )
}
