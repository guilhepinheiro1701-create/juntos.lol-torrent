/**
 * "Tem versao nova?" — o site pergunta ao GitHub, no maximo a cada 6 horas.
 *
 * O build carimba o commit (VITE_GIT_SHA, preenchido pelo start/atualizar).
 * A pergunta e uma leitura publica da API do GitHub, sem conta e sem nada
 * desta maquina no pedido alem do proprio pedido.
 */
export const REPO = 'guilhepinheiro1701-create/juntos.lol-torrent'
export const BRANCH = 'local'
export const REPO_URL = `https://github.com/${REPO}`
export const COMMIT = (import.meta.env.VITE_GIT_SHA as string | undefined) ?? 'dev'

const CACHE_KEY = 'ss.update-check.v1'
const EVERY_MS = 6 * 60 * 60 * 1000

export interface UpdateInfo {
  latest: string
  /** Primeira linha das mensagens dos commits novos, do mais antigo ao mais novo. */
  changes: string[]
}

export function knownCommit(sha: string = COMMIT): boolean {
  return /^[0-9a-f]{7,40}$/i.test(sha)
}

interface Cached { at: number; current: string; info: UpdateInfo | null }

function readCache(): Cached | null {
  try {
    const value = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as Cached | null
    return value && typeof value.at === 'number' && value.current === COMMIT ? value : null
  } catch {
    return null
  }
}

export async function checkForUpdate(fetcher: typeof fetch = fetch, now = Date.now()): Promise<UpdateInfo | null> {
  if (!knownCommit()) return null
  const cached = readCache()
  if (cached && now - cached.at < EVERY_MS) return cached.info
  let info: UpdateInfo | null = null
  try {
    const head = await fetcher(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, { headers: { Accept: 'application/vnd.github+json' } })
    if (!head.ok) return cached?.info ?? null
    const latest = String(((await head.json()) as { sha?: unknown }).sha ?? '')
    if (knownCommit(latest) && !latest.startsWith(COMMIT) && !COMMIT.startsWith(latest)) {
      let changes: string[] = []
      try {
        const compare = await fetcher(`https://api.github.com/repos/${REPO}/compare/${COMMIT}...${latest}`)
        if (compare.ok) {
          const body = (await compare.json()) as { status?: string; commits?: Array<{ commit?: { message?: string } }> }
          // "behind" ou "identical": esta instalacao esta a frente (alguem
          // compilou algo que ainda nao subiu). Nao ha o que oferecer.
          if (body.status === 'behind' || body.status === 'identical') {
            write({ at: now, current: COMMIT, info: null })
            return null
          }
          changes = (body.commits ?? [])
            .map((entry) => String(entry.commit?.message ?? '').split('\n')[0].trim())
            .filter(Boolean)
        }
      } catch {}
      info = { latest, changes }
    }
  } catch {
    return cached?.info ?? null
  }
  write({ at: now, current: COMMIT, info })
  return info
}

function write(value: Cached): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(value)) } catch {}
}
