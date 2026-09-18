import { useEffect, useState } from 'react'
import { HardDrive } from 'lucide-react'
import type { Translator } from '../i18n/useT'
import { storagePlaces, type StoragePlace } from '../remoteTorrent'
import { setStoragePreference, storagePreference } from '../storagePlace'

/**
 * Which disk the next film goes on.
 *
 * The list comes from the workers: an installation says where it is willing to
 * store things, and this picks among those. A browser never names a path, so
 * there is nothing here to point somewhere it should not go.
 *
 * Nothing shows when the fleet offers one place or none, which is every
 * ordinary install: a choice between one thing is not a choice.
 */
export function StoragePicker({ t }: { t: Translator }) {
  const [places, setPlaces] = useState<StoragePlace[]>([])
  const [chosen, setChosen] = useState(storagePreference)

  useEffect(() => {
    let disposed = false
    void storagePlaces()
      .then((next) => { if (!disposed) setPlaces(next) })
      .catch(() => undefined)
    return () => { disposed = true }
  }, [])

  // A preference naming a place the fleet no longer offers would silently be
  // refused at the next play, so say so where it can be corrected.
  const stale = chosen !== '' && places.length > 0
    && !places.some((place) => place.label.toLowerCase() === chosen.toLowerCase())

  if (places.length < 2 && !stale) return null

  const choose = (label: string) => {
    setStoragePreference(label)
    setChosen(label)
  }

  return (
    <section className="storage-picker">
      <h3><HardDrive size={15} aria-hidden="true" />{t('storage.title')}</h3>
      <p>{t('storage.guide')}</p>
      {stale ? <p className="storage-stale" role="status">{t('storage.stale')}</p> : null}
      <div className="storage-options" role="radiogroup" aria-label={t('storage.title')}>
        <button
          type="button"
          role="radio"
          aria-checked={chosen === ''}
          className={chosen === '' ? 'is-chosen' : ''}
          onClick={() => choose('')}
        >
          <span className="storage-label">{t('storage.automatic')}</span>
        </button>
        {places.map((place) => (
          <button
            key={place.label}
            type="button"
            role="radio"
            aria-checked={chosen.toLowerCase() === place.label.toLowerCase()}
            className={chosen.toLowerCase() === place.label.toLowerCase() ? 'is-chosen' : ''}
            onClick={() => choose(place.label)}
          >
            <span className="storage-label">{place.label}</span>
            {place.freeBytes > 0 ? (
              <span className="storage-free">
                {t('storage.free').replace('{size}', `${(place.freeBytes / 1_073_741_824).toFixed(0)} GB`)}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </section>
  )
}
