import type { TitlePick } from '../catalog/MetaDetails'
import { openCatalogStream } from '../catalog/openStream'
import type { WorkerProbe } from '../torrent'
import { isTorrentError } from '../torrentErrors'

export const RACE_SIZE = 3
export const RACE_LISTING_MS = 40_000

/**
 * Abre varias fontes juntas e fica com a primeira que listar. As que perdem
 * sao canceladas; uma que ainda assim termine depois e destruida. Se todas
 * falham, o erro mais informativo sobe (um "sem metadados" so se for o unico).
 */
export async function raceOpen(
  batch: TitlePick[],
  outer: AbortSignal,
  listingTimeoutMs: number | undefined,
  onProbe: (probes: WorkerProbe[]) => void,
): Promise<{ opened: Awaited<ReturnType<typeof openCatalogStream>>; pick: TitlePick }> {
  const controllers = batch.map(() => new AbortController())
  const forward = () => controllers.forEach((controller) => controller.abort())
  outer.addEventListener('abort', forward, { once: true })
  let settled = false
  const errors: unknown[] = []
  try {
    return await new Promise((resolve, reject) => {
      let pending = batch.length
      batch.forEach((pick, index) => {
        openCatalogStream(pick.stream, pick.target, undefined, {
          ...(index === 0 ? { onProbe } : {}),
          signal: controllers[index].signal,
          ...(listingTimeoutMs ? { listingTimeoutMs } : {}),
        }).then((opened) => {
          if (settled) { opened.session.destroy(); return }
          settled = true
          controllers.forEach((controller, other) => { if (other !== index) controller.abort() })
          resolve({ opened, pick })
        }, (error: unknown) => {
          errors.push(error)
          pending -= 1
          if (pending === 0 && !settled) {
            settled = true
            const telling = errors.find((e) => !(isTorrentError(e) && (e as { code?: string }).code === 'no_metadata'))
            reject(outer.aborted ? new DOMException('cancelled', 'AbortError') : (telling ?? errors[errors.length - 1]))
          }
        })
      })
    })
  } finally {
    outer.removeEventListener('abort', forward)
  }
}
