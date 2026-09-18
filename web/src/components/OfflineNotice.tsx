import { CloudOff, HardDriveDownload } from 'lucide-react'
import type { Translator } from '../i18n/useT'
import { library } from '../library'

/**
 * What the catalogue turns into with no internet.
 *
 * The catalogue reads a metadata service and the addons behind it, so it has
 * nothing to show. Everything already downloaded does, and it is on this
 * machine. So the answer is not an error: it is the door to the other room,
 * with the count on it, because "you have 4 films here" is the whole reason
 * this screen is worth showing instead of a spinner that never finishes.
 */
export function OfflineNotice({ t, onDownloads }: {
  t: Translator
  onDownloads: () => void
}) {
  const held = library().length

  return (
    <div className="offline-notice" role="status">
      <CloudOff size={28} aria-hidden="true" />
      <h2>{t('offline.title')}</h2>
      <p>{t('offline.guide')}</p>
      {held > 0 ? (
        <button type="button" className="primary-button raised" onClick={onDownloads}>
          <HardDriveDownload size={16} aria-hidden="true" />
          {t(held === 1 ? 'offline.watchOne' : 'offline.watchMany').replace('{count}', String(held))}
        </button>
      ) : (
        <p className="offline-empty">{t('offline.nothingKept')}</p>
      )}
    </div>
  )
}
