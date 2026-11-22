import { useEffect, useState } from 'react'
import { ArrowUpCircle } from 'lucide-react'
import { Dialog, DialogContent } from '../ui/Dialog'
import { checkForUpdate, REPO_URL, type UpdateInfo } from '../update'

type Translate = (key: string) => string

/** A pilula "Atualizacao disponivel" no cabecalho, e o que fazer para atualizar. */
export function UpdateNotice({ t }: { t: Translate }) {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      void checkForUpdate().then((value) => { if (!cancelled) setInfo(value) })
    }, 3_000)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [])

  if (!info) return null
  return (
    <>
      <button type="button" className="update-pill" onClick={() => setOpen(true)} title={t('update.available')} aria-label={t('update.available')}>
        <ArrowUpCircle size={15} aria-hidden="true" />
        <span className="nav-label">{t('update.short')}</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={t('home.closeDialog')} title={t('update.title')} description={t('update.guide')}>
          {info.changes.length > 0 ? (
            <>
              <p className="update-subtitle">{t('update.changes')}</p>
              <ul className="update-changes">
                {info.changes.slice(-10).reverse().map((change, index) => <li key={index}>{change}</li>)}
              </ul>
            </>
          ) : null}
          <ol className="update-steps">
            <li>{t('update.step1')}</li>
            <li>{t('update.step2')}</li>
          </ol>
          <p className="update-foot">
            <a href={`${REPO_URL}/commits/local`} target="_blank" rel="noreferrer noopener">{t('update.history')}</a>
          </p>
        </DialogContent>
      </Dialog>
    </>
  )
}
