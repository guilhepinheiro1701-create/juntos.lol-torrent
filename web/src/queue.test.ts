import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NoVideoInTorrentError, queueDownload } from './queue'
import type { TorrentSession } from './torrent'

const MAGNET = 'magnet:?xt=urn:btih:' + 'ab'.repeat(20) + '&dn=Duna'

function sessaoFalsa(over: Partial<TorrentSession> = {}): TorrentSession {
  return {
    name: 'Duna', jobId: 'j1', subtitleFiles: [],
    files: [
      { name: 'extra.mkv', path: 'x/extra.mkv', index: 1, size: 200, type: 'video/x-matroska', progress: 0, downloaded: 0 },
      { name: 'Duna.mkv', path: 'x/Duna.mkv', index: 0, size: 9_000, type: 'video/x-matroska', progress: 0, downloaded: 0 },
    ],
    stats: () => ({ peers: 0, downloadSpeed: 0, downloaded: 0, progress: 0 }),
    select: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
    detach: vi.fn(),
    ...over,
  } as TorrentSession
}

beforeEach(() => localStorage.clear())

describe('pôr um filme na fila sem abrir o player', () => {
  it('escolhe o maior vídeo, marca para ficar e solta sem devolver o trabalho', async () => {
    const session = sessaoFalsa()
    const keep = vi.fn().mockResolvedValue(undefined)
    const save = vi.fn()

    const posto = await queueDownload(
      { magnet: MAGNET, title: 'Duna', poster: 'https://img.test/d.jpg' },
      { open: async () => session, keep, save },
    )

    expect(session.select).toHaveBeenCalledWith('x/Duna.mkv')
    // Sem a marca, o worker pausa dois minutos depois e o download morre ali.
    expect(keep).toHaveBeenCalledWith('j1', true)
    // detach para de olhar; destroy devolveria o trabalho, que e o oposto.
    expect(session.detach).toHaveBeenCalledOnce()
    expect(session.destroy).not.toHaveBeenCalled()

    expect(posto.fileName).toBe('Duna.mkv')
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      roomId: 'q:' + 'ab'.repeat(20), jobId: 'j1', title: 'Duna',
      poster: 'https://img.test/d.jpg', filePath: 'x/Duna.mkv', magnet: MAGNET,
    }))
  })

  it('respeita o arquivo que já foi escolhido', async () => {
    const session = sessaoFalsa()
    await queueDownload(
      { magnet: MAGNET, filePath: 'x/extra.mkv' },
      { open: async () => session, keep: vi.fn().mockResolvedValue(undefined), save: vi.fn() },
    )
    expect(session.select).toHaveBeenCalledWith('x/extra.mkv')
  })

  // Falhar no meio nao pode deixar um trabalho pendurado no worker ocupando
  // disco que ninguem vai reclamar.
  it('devolve o trabalho quando não há vídeo nenhum', async () => {
    const session = sessaoFalsa({ files: [] })
    const save = vi.fn()

    await expect(queueDownload({ magnet: MAGNET }, { open: async () => session, save }))
      .rejects.toBeInstanceOf(NoVideoInTorrentError)

    expect(session.destroy).toHaveBeenCalledOnce()
    expect(save).not.toHaveBeenCalled()
  })

  it('devolve o trabalho quando a marca falha', async () => {
    const session = sessaoFalsa()
    const keep = vi.fn().mockRejectedValue(new Error('rede'))

    await expect(queueDownload({ magnet: MAGNET }, { open: async () => session, keep, save: vi.fn() }))
      .rejects.toThrow('rede')

    expect(session.destroy).toHaveBeenCalledOnce()
  })

  it('recusa um magnet sem infohash antes de tocar na rede', async () => {
    const open = vi.fn()
    await expect(queueDownload({ magnet: 'magnet:?dn=nada' }, { open })).rejects.toThrow()
    expect(open).not.toHaveBeenCalled()
  })
})
