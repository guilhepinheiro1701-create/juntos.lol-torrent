import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Translator } from '../i18n/useT'
import { LibraryShelf } from './LibraryShelf'
import { ToastProvider } from '../ui/Toast'
import { openTorrent } from '../torrent'
import { createRoomAndUploadTorrent } from '../upload'
import { jobProgress, keepTorrent } from '../remoteTorrent'
import { resumeInterrupted } from '../queue'

vi.mock('../torrent', () => ({ openTorrent: vi.fn() }))
vi.mock('../upload', () => ({ createRoomAndUploadTorrent: vi.fn() }))
vi.mock('../remoteTorrent', () => ({
  keepTorrent: vi.fn(),
  jobProgress: vi.fn().mockResolvedValue(null),
  storagePlaces: vi.fn().mockResolvedValue([]),
}))
vi.mock('../queue', () => ({ resumeInterrupted: vi.fn().mockResolvedValue([]) }))

const t = ((key: string) => key) as Translator

const entry = (extra: Record<string, unknown> = {}) => ({
  roomId: 'r1', jobId: 'j1', fileName: 'Duna.mkv', title: 'Duna',
  magnet: 'magnet:?xt=urn:btih:abc', filePath: 'Duna/Duna.mkv',
  savedAt: Date.now(), ...extra,
})

function shelf(onOpened = vi.fn()) {
  render(<ToastProvider><LibraryShelf t={t} onOpened={onOpened} /></ToastProvider>)
  return onOpened
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.mocked(keepTorrent).mockResolvedValue(undefined)
  vi.mocked(jobProgress).mockResolvedValue(null)
})

afterEach(() => vi.restoreAllMocks())

describe('LibraryShelf', () => {
  it('says what the shelf is for when nothing is on it', () => {
    shelf()

    expect(screen.getByText('library.emptyTitle')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('lists what was downloaded, naming it by its title', () => {
    localStorage.setItem('ss.library', JSON.stringify([entry()]))
    shelf()

    expect(screen.getByText('Duna')).toBeInTheDocument()
  })

  it('falls back to the file name for a download with no catalogue title', () => {
    localStorage.setItem('ss.library', JSON.stringify([entry({ title: undefined })]))
    shelf()

    expect(screen.getByText('Duna.mkv')).toBeInTheDocument()
  })

  // Reopening makes a new job from the magnet rather than resurrecting the old
  // one: the worker still has the bytes, so nothing downloads again.
  it('reopens the download from its magnet and lands in the new room', async () => {
    localStorage.setItem('ss.library', JSON.stringify([entry()]))
    const session = {
      jobId: 'j2',
      files: [{ path: 'Duna/other.mkv' }, { path: 'Duna/Duna.mkv' }],
      select: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn(),
    }
    vi.mocked(openTorrent).mockResolvedValue(session as never)
    vi.mocked(createRoomAndUploadTorrent).mockResolvedValue({ roomID: 'r2', nickname: '' })
    const onOpened = shelf()

    fireEvent.click(screen.getByRole('button', { name: /library\.play/ }))

    await waitFor(() => expect(onOpened).toHaveBeenCalledWith('r2'))
    expect(openTorrent).toHaveBeenCalledWith('magnet:?xt=urn:btih:abc')
    // The recorded file, not simply the first one in the torrent.
    expect(session.select).toHaveBeenCalledWith('Duna/Duna.mkv')
    // The new job carries the mark too, or the reaper may come back for it.
    expect(keepTorrent).toHaveBeenCalledWith('j2', true)
  })

  it('reports a reopening that failed instead of leaving the button spinning', async () => {
    localStorage.setItem('ss.library', JSON.stringify([entry()]))
    vi.mocked(openTorrent).mockRejectedValue(new Error('no workers'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    shelf()

    fireEvent.click(screen.getByRole('button', { name: /library\.play/ }))

    await screen.findByText('library.openFailed')
    await waitFor(() => expect(screen.getByRole('button', { name: /library\.play/ })).not.toBeDisabled())
  })

  it('refuses to reopen a record with no source to reopen from', async () => {
    localStorage.setItem('ss.library', JSON.stringify([entry({ magnet: undefined })]))
    shelf()

    fireEvent.click(screen.getByRole('button', { name: /library\.play/ }))

    await screen.findByText('library.noMagnet')
    expect(openTorrent).not.toHaveBeenCalled()
  })

  it('gives the space back and drops the row', async () => {
    localStorage.setItem('ss.library', JSON.stringify([entry()]))
    shelf()

    fireEvent.click(screen.getByRole('button', { name: 'library.drop' }))

    await waitFor(() => expect(keepTorrent).toHaveBeenCalledWith('j1', false))
    await waitFor(() => expect(screen.getByText('library.emptyTitle')).toBeInTheDocument())
    expect(JSON.parse(localStorage.getItem('ss.library')!)).toHaveLength(0)
  })

  // The viewer said they are done with it. A worker that cannot be reached is
  // not a reason to keep showing them a row they asked to remove.
  it('drops the row even when the worker cannot be told', async () => {
    localStorage.setItem('ss.library', JSON.stringify([entry()]))
    vi.mocked(keepTorrent).mockRejectedValue(new Error('not yours'))
    shelf()

    fireEvent.click(screen.getByRole('button', { name: 'library.drop' }))

    await waitFor(() => expect(screen.getByText('library.emptyTitle')).toBeInTheDocument())
    expect(JSON.parse(localStorage.getItem('ss.library')!)).toHaveLength(0)
  })
})

const GB = 1_073_741_824

// Um download pela metade nao tem por que parecer pronto: e a pergunta que a
// pessoa faz ao abrir esta aba, e a resposta estava faltando.
describe('how far along each download is', () => {
  const at = (over: Record<string, unknown> = {}) => ({
    kept: 'kept' as const, progress: 0.42, haveBytes: 4.2 * GB,
    totalBytes: 10 * GB, downSpeed: 0, state: 'running', ...over,
  })

  it('shows the percentage and the bytes while it is still coming', async () => {
    localStorage.setItem('ss.library', JSON.stringify([entry()]))
    vi.mocked(jobProgress).mockResolvedValue(at())
    shelf()

    expect(await screen.findByText('42%')).toBeInTheDocument()
    const bar = screen.getByRole('progressbar', { name: 'Duna' })
    expect(bar).toHaveAttribute('aria-valuenow', '42')
    // O texto sai em nos separados, entao a asercao e sobre o elemento.
    expect(document.querySelector('.library-line .is-quiet')).toHaveTextContent('4.2 GB / 10.0 GB')
  })

  it('says it is complete once everything is on disk', async () => {
    localStorage.setItem('ss.library', JSON.stringify([entry()]))
    vi.mocked(jobProgress).mockResolvedValue(at({ progress: 1, haveBytes: 10 * GB }))
    shelf()

    expect(await screen.findByText('library.complete')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  // Dizer "0%" quando na verdade nao se sabe e pior que nao dizer nada.
  it('admits it does not know rather than showing a zero', async () => {
    localStorage.setItem('ss.library', JSON.stringify([entry()]))
    vi.mocked(jobProgress).mockResolvedValue(at({ progress: null }))
    shelf()

    expect(await screen.findByText('library.checking')).toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })

  it('names the film and keeps the file name underneath', () => {
    localStorage.setItem('ss.library', JSON.stringify([entry({ poster: 'https://img.test/duna.jpg' })]))
    shelf()

    expect(screen.getByText('Duna')).toBeInTheDocument()
    expect(screen.getByText('Duna.mkv')).toBeInTheDocument()
    expect(document.querySelector('.library-poster')).toHaveAttribute('src', 'https://img.test/duna.jpg')
  })
})

// Quem acabou de por um filme na fila abre esta aba para ver aquele, e nao
// para procura-lo no meio dos que ja estao prontos.
describe('a fila e o que ja esta pronto', () => {
  const GB2 = 1_073_741_824
  const andando = { kept: 'kept' as const, progress: 0.3, haveBytes: GB2, totalBytes: 3 * GB2, downSpeed: 0, state: 'running' }
  const pronto = { kept: 'kept' as const, progress: 1, haveBytes: GB2, totalBytes: GB2, downSpeed: 0, state: 'running' }

  it('separa os dois, e conta quantos estao baixando', async () => {
    localStorage.setItem('ss.library', JSON.stringify([
      entry({ roomId: 'r1', jobId: 'j1', title: 'Baixando' }),
      entry({ roomId: 'r2', jobId: 'j2', title: 'Pronto' }),
    ]))
    vi.mocked(jobProgress).mockImplementation(async (id: string) => (id === 'j1' ? andando : pronto))
    shelf()

    expect(await screen.findByText('library.queue')).toBeInTheDocument()
    expect(screen.getByText('library.done')).toBeInTheDocument()
    expect(document.querySelector('.library-group h3 em')).toHaveTextContent('1')
  })

  // Sem resposta do worker, o filme fica onde estava antes de existir fila:
  // chutar "baixando" seria inventar.
  it('nao chama de fila o que ainda nao respondeu', async () => {
    localStorage.setItem('ss.library', JSON.stringify([entry()]))
    vi.mocked(jobProgress).mockResolvedValue(null)
    shelf()

    await screen.findByText('library.checking')
    expect(screen.queryByText('library.queue')).not.toBeInTheDocument()
  })
})

// O pc desliga, ou o docker fecha. Os bytes continuam no disco, mas o trabalho
// que sabia do download morreu junto — e ate agora nada mandava continuar.
describe('retomar um download interrompido', () => {
  const GB = 1_073_741_824

  beforeEach(() => {
    vi.mocked(resumeInterrupted).mockResolvedValue([])
  })

  it('chama a retomada quando o trabalho sumiu, e mostra que está retomando', async () => {
    localStorage.setItem('ss.library', JSON.stringify([entry({ have: 8 * GB, total: 10 * GB })]))
    vi.mocked(jobProgress).mockResolvedValue('gone')
    vi.mocked(resumeInterrupted).mockImplementation(async (deps) => {
      deps?.onStart?.(entry() as never)
      return []
    })
    shelf()

    expect(await screen.findByText('library.resuming')).toBeInTheDocument()
  })

  // "Não consegui perguntar" é diferente de "o trabalho não existe": nem sequer
  // vale a pena acordar a retomada.
  it('não chama a retomada quando a pergunta apenas falhou', async () => {
    localStorage.setItem('ss.library', JSON.stringify([entry({ have: 8 * GB, total: 10 * GB })]))
    vi.mocked(jobProgress).mockResolvedValue(null)
    shelf()

    await screen.findByText('library.checking')
    expect(resumeInterrupted).not.toHaveBeenCalled()
  })

  it('anota o progresso, para saber depois o que ficou pela metade', async () => {
    localStorage.setItem('ss.library', JSON.stringify([entry()]))
    vi.mocked(jobProgress).mockResolvedValue({
      kept: 'kept', progress: 0.5, haveBytes: 5 * GB, totalBytes: 10 * GB, downSpeed: 0, state: 'running',
    })
    shelf()

    await waitFor(() => {
      const guardado = JSON.parse(localStorage.getItem('ss.library') ?? '[]') as { have: number; total: number }[]
      expect(guardado[0].have).toBe(5 * GB)
      expect(guardado[0].total).toBe(10 * GB)
    })
  })
})
