import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Translator } from '../i18n/useT'
import { LibraryShelf } from './LibraryShelf'
import { ToastProvider } from '../ui/Toast'
import { openTorrent } from '../torrent'
import { createRoomAndUploadTorrent } from '../upload'
import { keepTorrent } from '../remoteTorrent'

vi.mock('../torrent', () => ({ openTorrent: vi.fn() }))
vi.mock('../upload', () => ({ createRoomAndUploadTorrent: vi.fn() }))
vi.mock('../remoteTorrent', () => ({ keepTorrent: vi.fn() }))

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
