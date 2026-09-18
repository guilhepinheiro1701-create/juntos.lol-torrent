import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RoomPage } from './Room'
import { ToastProvider } from '../ui/Toast'
import { changeRoomSource, startUrlUpload } from '../upload'

vi.mock('../upload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../upload')>()),
  changeRoomSource: vi.fn().mockResolvedValue({
    status: 'uploading', sourceKind: 'upload', fileName: 'next.mkv',
    mediaGeneration: 1, uploadEndpoint: '/api/upload/', streamStartBytes: 1024,
  }),
  startUrlUpload: vi.fn(),
}))

function renderRoom() {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/room/abc123']}>
        <Routes><Route path="/room/:id" element={<RoomPage />} /></Routes>
      </MemoryRouter>
    </ToastProvider>,
  )
}

describe('RoomPage opening', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'abc123',
        fileName: 'movie.mkv',
        status: 'uploading',
        sourceKind: 'upload',
        mediaGeneration: 0,
        controllerId: 'm1',
        audioTracks: null,
        subtitleTracks: null,
        bitmapSubsSkipped: 0,
        memberCount: 1,
        expiresAt: '2099-01-01T00:00:00Z',
      }),
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // A name existed so the other people in the room knew who had arrived.
  it('opens straight into the room, without asking for a name', async () => {
    renderRoom()

    // The room is still preparing, so what should be on screen is the preparo
    // — never a form asking who we are.
    await screen.findByRole('heading', { name: /preparing your video|preparando seu vídeo/i })
    expect(screen.queryByLabelText(/your name|seu nome/i)).not.toBeInTheDocument()
  })
})

describe('RoomPage source swap', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'abc123', fileName: 'movie.mkv', status: 'ready',
        sourceKind: 'upload', mediaGeneration: 0, controllerId: 'm1',
        audioTracks: null, subtitleTracks: null, bitmapSubsSkipped: 0,
        memberCount: 1, expiresAt: '2099-01-01T00:00:00Z',
      }),
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  // There used to be a second case here: the swap was hidden from anyone who
  // was not driving the room. With one viewer there is nobody it can be hidden
  // from, so the offer is unconditional.
  it('offers the swap', async () => {
    renderRoom()

    expect(await screen.findByRole('button', { name: /change media|trocar mídia/i })).toBeInTheDocument()
  })
})

describe('RoomPage retomar o preparo', () => {
  const roomWith = (mediaRegions: unknown, producerHeartbeatMs?: number) => ({
    id: 'abc123', fileName: 'movie.mkv', status: 'ready',
    sourceKind: 'upload', mediaGeneration: 0, controllerId: 'm1',
    audioTracks: null, subtitleTracks: null, bitmapSubsSkipped: 0,
    durationMs: 600_000, mediaRegions, producerHeartbeatMs,
    memberCount: 1, expiresAt: '2099-01-01T00:00:00Z',
  })

  const setup = (mediaRegions: unknown, producerHeartbeatMs?: number) => {
    localStorage.clear()
    // Reopening the source is authorized by the owner token.
    localStorage.setItem('ss.owner.abc123', 'owner-secret')
    localStorage.setItem('ss.resume.abc123', JSON.stringify({
      kind: 'url', fileName: 'movie.mkv', url: 'https://example.test/movie.mkv', size: 10, savedAt: Date.now(),
    }))
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => roomWith(mediaRegions, producerHeartbeatMs) }))
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('leaves a room alone when a region already covers where it is', async () => {
    setup([{ n: 0, startMs: 0, producedMs: 600_000, growing: false }])
    renderRoom()

    await screen.findByRole('button', { name: /change media|trocar mídia/i })
    expect(changeRoomSource).not.toHaveBeenCalled()
    expect(startUrlUpload).not.toHaveBeenCalled()
  })

  it('reopens the source when nothing holds the position the room is at', async () => {
    setup([{ n: 1, startMs: 500_000, producedMs: 100_000, growing: false }])
    renderRoom()

    await waitFor(() => expect(changeRoomSource).toHaveBeenCalled())
  })

  it('leaves a cold seek alone while a pipeline is still producing', async () => {
    setup([{ n: 1, startMs: 500_000, producedMs: 100_000, growing: false }], Date.now())
    renderRoom()

    await screen.findByRole('button', { name: /change media|trocar mídia/i })
    expect(changeRoomSource).not.toHaveBeenCalled()
    expect(startUrlUpload).not.toHaveBeenCalled()
  })

  it('picks the room up once the pipeline behind it has gone quiet', async () => {
    setup([{ n: 1, startMs: 500_000, producedMs: 100_000, growing: false }], Date.now() - 10 * 60_000)
    renderRoom()

    await waitFor(() => expect(changeRoomSource).toHaveBeenCalled())
  })
})

describe('RoomPage header', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'abc123', fileName: 'movie.mkv', status: 'ready',
        sourceKind: 'upload', mediaGeneration: 0, controllerId: 'm1',
        audioTracks: null, subtitleTracks: null, bitmapSubsSkipped: 0,
        memberCount: 1, expiresAt: '2099-01-01T00:00:00Z',
      }),
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })


  async function openRoom() {
    renderRoom()
    return await screen.findByRole('button', { name: /change media|trocar mídia/i })
  }

  it('no longer offers screen sharing next to the source switcher', async () => {
    await openRoom()

    expect(screen.queryByRole('button', { name: /share screen|compartilhar tela/i })).not.toBeInTheDocument()
  })






})

describe('RoomPage waiting screen', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  const roomBody = (receivedBytes: number) => ({
    id: 'abc123', fileName: 'movie.mkv', status: 'uploading',
    sourceKind: 'upload', mediaGeneration: 0, controllerId: 'm1',
    audioTracks: null, subtitleTracks: null, bitmapSubsSkipped: 0,
    memberCount: 1, expiresAt: '2099-01-01T00:00:00Z',
    preparation: {
      sourceBytes: 100 * 1024 * 1024,
      receivedBytes,
      previewPhase: 'receiving',
    },
  })

  it('keeps reading its own progress when no live update arrives', async () => {
    let received = 10 * 1024 * 1024
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => ({
      ok: true, status: 200, json: async () => roomBody(received),
    })))

    renderRoom()
    await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '10'))

    received = 40 * 1024 * 1024
    await waitFor(() => expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40'),
      { timeout: 6000 })
  }, 10_000)
})

describe('RoomPage download', () => {
  const room = {
    id: 'abc123', fileName: 'movie.mkv', status: 'ready',
    sourceKind: 'upload', mediaGeneration: 0, controllerId: 'm1',
    audioTracks: null, subtitleTracks: null, bitmapSubsSkipped: 0,
    memberCount: 1, expiresAt: '2099-01-01T00:00:00Z',
  }

  // The button needs a fleet job to address; after a reload that comes from
  // the resume hint the preparo left behind.
  const setup = (keep: boolean) => {
    localStorage.clear()
    localStorage.setItem('ss.owner.abc123', 'owner-secret')
    localStorage.setItem('ss.resume.abc123', JSON.stringify({
      kind: 'torrent', fileName: 'movie.mkv', magnet: 'magnet:?xt=urn:btih:abc',
      filePath: 'movie.mkv', jobId: 'j1', savedAt: Date.now(),
    }))
    const calls: { url: string; body?: string }[] = []
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? String(init.body) : undefined })
      if (String(url) === '/api/torrents/j1') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ jobId: 'j1', state: 'serving', ...(keep ? { keep: true } : {}) }) })
      }
      if (String(url).endsWith('/keep')) {
        return Promise.resolve({ ok: true, status: 204, json: async () => ({}) })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => room })
    }))
    return calls
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('offers the download and asks the worker to hold the file', async () => {
    const calls = setup(false)
    renderRoom()

    const button = await screen.findByRole('button', { name: /^(download|baixar)$/i })
    await waitFor(() => expect(button).not.toBeDisabled())
    fireEvent.click(button)

    await waitFor(() => expect(calls.some((call) => call.url === '/api/torrents/j1/keep' && call.body === '{"keep":true}')).toBe(true))
    await screen.findByRole('button', { name: /downloaded|baixado/i })
    expect(JSON.parse(localStorage.getItem('ss.library')!)).toHaveLength(1)
  })

  it('reads the kept state off the worker rather than off this browser', async () => {
    setup(true)
    renderRoom()

    await screen.findByRole('button', { name: /downloaded|baixado/i })
  })

  // A library entry for a file the worker no longer holds is a promise the
  // page cannot keep, so it goes.
  it('drops a library entry the worker has already let go', async () => {
    setup(false)
    localStorage.setItem('ss.library', JSON.stringify([
      { roomId: 'abc123', jobId: 'j1', fileName: 'movie.mkv', savedAt: Date.now() },
    ]))
    renderRoom()

    await screen.findByRole('button', { name: /^(download|baixar)$/i })
    await waitFor(() => expect(JSON.parse(localStorage.getItem('ss.library')!)).toHaveLength(0))
  })

  it('gives the space back when the download is undone', async () => {
    const calls = setup(true)
    localStorage.setItem('ss.library', JSON.stringify([
      { roomId: 'abc123', jobId: 'j1', fileName: 'movie.mkv', savedAt: Date.now() },
    ]))
    renderRoom()

    const button = await screen.findByRole('button', { name: /downloaded|baixado/i })
    await waitFor(() => expect(button).not.toBeDisabled())
    fireEvent.click(button)

    await waitFor(() => expect(calls.some((call) => call.url === '/api/torrents/j1/keep' && call.body === '{"keep":false}')).toBe(true))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('ss.library')!)).toHaveLength(0))
  })

  // Without one there is nothing to address, and the header should not carry a
  // button that cannot do anything.
  it('shows nothing at all for a room with no fleet job', async () => {
    setup(false)
    localStorage.removeItem('ss.resume.abc123')
    renderRoom()

    await screen.findByRole('button', { name: /change media|trocar mídia/i })
    expect(screen.queryByRole('button', { name: /^(download|baixar)$/i })).not.toBeInTheDocument()
  })
})
