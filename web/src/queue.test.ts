import { beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetResumeAttempts, NoVideoInTorrentError, queueDownload, resumeInterrupted } from './queue'
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

// O pc desliga, ou o docker fecha. Os bytes continuam no disco — o kept.json
// do worker poupa essas pastas da varredura de subida — mas o trabalho que
// sabia do download morreu junto, e ate agora nada mandava continuar.
describe('retomar o que ficou pela metade', () => {
  const GB = 1_073_741_824
  const entrada = (over: Record<string, unknown> = {}) => ({
    roomId: 'r1', jobId: 'j-morto', fileName: 'Duna.mkv', title: 'Duna',
    poster: 'https://img.test/d.jpg', magnet: MAGNET, filePath: 'x/Duna.mkv',
    have: 8 * GB, total: 10 * GB, savedAt: 1, ...over,
  })

  beforeEach(() => forgetResumeAttempts())

  it('reabre o trabalho a partir do magnet, mantendo capa e nome', async () => {
    const session = sessaoFalsa()
    const bind = vi.fn()

    const feitas = await resumeInterrupted({
      list: () => [entrada()] as never,
      look: async () => 'gone',
      bind,
      open: async () => session,
      keep: vi.fn().mockResolvedValue(undefined),
      save: vi.fn(),
    })

    expect(feitas).toHaveLength(1)
    expect(session.select).toHaveBeenCalledWith('x/Duna.mkv')
    expect(bind).toHaveBeenCalledWith('r1', 'j1')
  })

  it('deixa em paz o que já estava completo', async () => {
    const open = vi.fn()
    await resumeInterrupted({ list: () => [entrada({ have: 10 * GB, total: 10 * GB })] as never, look: async () => 'gone', open })
    expect(open).not.toHaveBeenCalled()
  })

  // "Não consegui perguntar" é diferente de "o trabalho não existe": recomeçar
  // por uma falha de rede criaria trabalho duplicado no worker.
  it('não recomeça quando a pergunta apenas falhou', async () => {
    const open = vi.fn()
    await resumeInterrupted({ list: () => [entrada()] as never, look: async () => null, open })
    expect(open).not.toHaveBeenCalled()
  })

  it('não recomeça o que está vivo', async () => {
    const open = vi.fn()
    const vivo = { kept: 'kept' as const, progress: 0.8, haveBytes: 8, totalBytes: 10, downSpeed: 1, state: 'running' }
    await resumeInterrupted({ list: () => [entrada()] as never, look: async () => vivo, open })
    expect(open).not.toHaveBeenCalled()
  })

  it('tenta uma vez só por sessão, mesmo falhando', async () => {
    const open = vi.fn().mockRejectedValue(new Error('enxame mudo'))
    const deps = { list: () => [entrada()] as never, look: async () => 'gone' as const, open, bind: vi.fn() }

    await resumeInterrupted(deps)
    await resumeInterrupted(deps)

    expect(open).toHaveBeenCalledOnce()
  })

  it('ignora uma entrada sem magnet, que não tem como reabrir', async () => {
    const open = vi.fn()
    await resumeInterrupted({ list: () => [entrada({ magnet: undefined })] as never, look: async () => 'gone', open })
    expect(open).not.toHaveBeenCalled()
  })
})
