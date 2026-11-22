import { useState } from 'react'
import { ListChecks, Settings, Sparkles } from 'lucide-react'
import { Dialog, DialogContent } from '../ui/Dialog'
import { setSourceMode, useSourceMode, type SourceMode } from '../settings'

type Translate = (key: string) => string

/** A engrenagem do cabecalho e o que ela abre. */
export function SettingsButton({ t }: { t: Translate }) {
  const [open, setOpen] = useState(false)
  const mode = useSourceMode()
  const options: Array<{ value: SourceMode; icon: typeof Sparkles; title: string; guide: string }> = [
    { value: 'basic', icon: Sparkles, title: t('settings.basic'), guide: t('settings.basicGuide') },
    { value: 'advanced', icon: ListChecks, title: t('settings.advanced'), guide: t('settings.advancedGuide') },
  ]
  return (
    <>
      <button type="button" className="header-settings" onClick={() => setOpen(true)} aria-label={t('settings.open')} title={t('settings.open')}>
        <Settings size={16} aria-hidden="true" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={t('home.closeDialog')} title={t('settings.title')} description={t('settings.sourcesGuide')}>
          <p className="settings-section">{t('settings.sources')}</p>
          <div className="settings-options" role="radiogroup" aria-label={t('settings.sources')}>
            {options.map(({ value, icon: Icon, title, guide }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                className={`settings-option ${mode === value ? 'is-on' : ''}`}
                onClick={() => setSourceMode(value)}
              >
                <Icon size={18} aria-hidden="true" />
                <span>
                  <strong>{title}</strong>
                  <small>{guide}</small>
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
