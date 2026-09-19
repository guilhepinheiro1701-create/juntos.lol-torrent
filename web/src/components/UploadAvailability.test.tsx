import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { translate, type Translator } from '../i18n/useT'
import type { RoomPreparation } from '../types'
import { UploadAvailability } from './UploadAvailability'

const t = Object.assign((key: string) => translate('en', key), {
  language: 'en' as const,
  setLanguage: vi.fn(),
}) as Translator

const MB = 1024 * 1024

function renderPrep(preparation: RoomPreparation) {
  return render(<UploadAvailability t={t} progress={null} preparation={preparation} />)
}

describe('UploadAvailability', () => {
  it('waits quietly until any byte count exists', () => {
    render(<UploadAvailability t={t} progress={null} />)

    expect(screen.getByText('Waiting for the initial upload...')).toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it('measures the wait against the point playback can start, not the whole file', () => {
    renderPrep({
      sourceBytes: 600 * MB,
      receivedBytes: 30 * MB,
      previewPhase: 'segmenting',
      previewTargetBytes: 60 * MB,
    })

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
    expect(screen.getByText('Starts playing in')).toBeInTheDocument()
  })

  it('names the phase the source is actually in', () => {
    const { rerender } = renderPrep({ sourceBytes: 100 * MB, receivedBytes: MB, previewPhase: 'probing' })
    expect(screen.getByText('Analysing what has arrived…')).toBeInTheDocument()

    rerender(<UploadAvailability t={t} progress={null} preparation={{
      sourceBytes: 100 * MB, receivedBytes: 2 * MB, previewPhase: 'segmenting',
    }} />)
    expect(screen.getByText('Building the first segment…')).toBeInTheDocument()
  })

  it('says outright when a source cannot be previewed, and measures the whole file', () => {
    renderPrep({
      sourceBytes: 400 * MB,
      receivedBytes: 100 * MB,
      previewPhase: 'unavailable',
    })

    expect(screen.getByText(/cannot be previewed/)).toBeInTheDocument()
    expect(screen.getByText('Finishes in')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
  })

  it('falls back to the file itself while the playable point is unknown', () => {
    renderPrep({ sourceBytes: 200 * MB, receivedBytes: 50 * MB, previewPhase: 'receiving' })

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25')
    expect(screen.getByText('Finishes in')).toBeInTheDocument()
  })

  it('prefers the server count over this tab, so every viewer sees the same figure', () => {
    render(<UploadAvailability
      t={t}
      progress={{ pct: 90, bytesUploaded: 90 * MB, bytesTotal: 100 * MB }}
      preparation={{ sourceBytes: 100 * MB, receivedBytes: 10 * MB, previewPhase: 'receiving' }}
    />)

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '10')
  })

  it('uses this tab as the fallback when the server has published nothing', () => {
    render(<UploadAvailability
      t={t}
      progress={{ pct: 20, bytesUploaded: 20 * MB, bytesTotal: 100 * MB }}
    />)

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20')
  })

  describe('estimate', () => {
    beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
    afterEach(() => { vi.useRealTimers() })

    it('declines to guess before it has watched the transfer', () => {
      renderPrep({ sourceBytes: 600 * MB, receivedBytes: 10 * MB, previewTargetBytes: 60 * MB })

      expect(screen.getByText('estimating…')).toBeInTheDocument()
    })

    it('predicts from the rate it observed', () => {
      const { rerender } = renderPrep({
        sourceBytes: 600 * MB, receivedBytes: 10 * MB, previewTargetBytes: 60 * MB,
      })

      act(() => { vi.advanceTimersByTime(10_000) })
      rerender(<UploadAvailability t={t} progress={null} preparation={{
        sourceBytes: 600 * MB, receivedBytes: 20 * MB, previewTargetBytes: 60 * MB,
      }} />)

      expect(screen.getByText('under a minute')).toBeInTheDocument()
    })

    it('rounds a long wait to minutes rather than pretending to be exact', () => {
      const { rerender } = renderPrep({
        sourceBytes: 6000 * MB, receivedBytes: 10 * MB, previewTargetBytes: 610 * MB,
      })

      act(() => { vi.advanceTimersByTime(5_000) })
      rerender(<UploadAvailability t={t} progress={null} preparation={{
        sourceBytes: 6000 * MB, receivedBytes: 20 * MB, previewTargetBytes: 610 * MB,
      }} />)

      expect(screen.getByText('~5 min')).toBeInTheDocument()
    })

    it('forgets the previous source when the count restarts', () => {
      const { rerender } = renderPrep({
        sourceBytes: 600 * MB, receivedBytes: 300 * MB, previewTargetBytes: 60 * MB,
      })
      act(() => { vi.advanceTimersByTime(10_000) })

      rerender(<UploadAvailability t={t} progress={null} preparation={{
        sourceBytes: 600 * MB, receivedBytes: 0, previewTargetBytes: 60 * MB,
      }} />)

      expect(screen.getByText('estimating…')).toBeInTheDocument()
    })
  })
})

// O preparo só recebe o primeiro byte depois de o torrent ter juntado o
// bastante. Até lá a barra ficava parada em zero e o tempo dizia "calculando",
// enquanto o filme baixava a megabytes por segundo no mesmo cartão.
describe('while the torrent is still fetching', () => {
  const swarm = (over: Partial<{ peers: number; downloadSpeed: number; downloaded: number; progress: number }>) => ({
    peers: 2, downloadSpeed: 4 * MB, downloaded: 200 * MB, progress: 0.2, ...over,
  })

  it('shows how much of the torrent has arrived, and when the rest does', () => {
    render(<UploadAvailability t={t} progress={null} swarm={swarm({})} />)

    expect(screen.getByText('Downloading the film…')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20')
    expect(screen.getByText('20%')).toBeInTheDocument()
    // 1000 MB no total, 200 já vieram: 800 a 4 MB/s é pouco mais de 3 min.
    expect(screen.getByText('~3 min')).toBeInTheDocument()
  })

  it('says nothing about time while the speed is not worth extrapolating from', () => {
    render(<UploadAvailability t={t} progress={null} swarm={swarm({ downloadSpeed: 0 })} />)

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20')
    expect(screen.getByText('estimating…')).toBeInTheDocument()
  })

  it('waits quietly when the swarm has not moved at all', () => {
    render(<UploadAvailability t={t} progress={null} swarm={swarm({ downloaded: 0, progress: 0 })} />)

    expect(screen.getByText('Waiting for the initial upload...')).toBeInTheDocument()
  })

  // Assim que o preparo anda, é ele que manda: é o que separa "o filme chegou"
  // de "dá para apertar o play".
  it('hands the bar over to the preparation as soon as it starts', () => {
    render(
      <UploadAvailability
        t={t}
        progress={null}
        preparation={{ sourceBytes: 1000 * MB, receivedBytes: 500 * MB, previewPhase: 'segmenting' }}
        swarm={swarm({})}
      />,
    )

    expect(screen.queryByText('Downloading the film…')).not.toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
  })
})

// O tamanho do arquivo e conhecido desde o primeiro instante, entao qualquer
// condicao do tipo "ainda nao comecou" baseada nele ja nasce falsa num
// torrent. Foi assim que a barra do enxame ficou escrita e nunca rodou.
describe('with the file size already known and nothing prepared yet', () => {
  const swarm = (over: Record<string, unknown> = {}) => ({
    peers: 3, downloadSpeed: 4 * MB, downloaded: 200 * MB, progress: 0.2, ...over,
  })

  it('still reads the bar and the time from the torrent', () => {
    render(
      <UploadAvailability
        t={t}
        progress={null}
        preparation={{ sourceBytes: 1000 * MB, receivedBytes: 0 }}
        swarm={swarm()}
      />,
    )

    expect(screen.getByText('Downloading the film…')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20')
    expect(screen.queryByText('estimating…')).not.toBeInTheDocument()
  })

  // Reabrir um filme que ja esta no disco cria um trabalho novo, e o baixador
  // so chama de "tem" o pedaco que ja conferiu: a conta fica em zero, a
  // velocidade tambem, e o filme inteiro esta ali em diskBytes.
  it('says it is checking the disk instead of estimating forever', () => {
    render(
      <UploadAvailability
        t={t}
        progress={null}
        preparation={{ sourceBytes: 1000 * MB, receivedBytes: 0 }}
        swarm={swarm({ downloadSpeed: 0, downloaded: 10 * MB, progress: 0.01, diskBytes: 1000 * MB })}
      />,
    )

    expect(screen.getByText('Checking what is already on disk…')).toBeInTheDocument()
    expect(screen.getByText('nearly there')).toBeInTheDocument()
    expect(screen.queryByText('estimating…')).not.toBeInTheDocument()
  })

  it('does not call it checking while the bytes are genuinely still coming', () => {
    render(
      <UploadAvailability
        t={t}
        progress={null}
        preparation={{ sourceBytes: 1000 * MB, receivedBytes: 0 }}
        swarm={swarm({ downloadSpeed: 0, downloaded: 10 * MB, progress: 0.01, diskBytes: 10 * MB })}
      />,
    )

    expect(screen.queryByText('Checking what is already on disk…')).not.toBeInTheDocument()
    expect(screen.getByText('Downloading the film…')).toBeInTheDocument()
  })
})
