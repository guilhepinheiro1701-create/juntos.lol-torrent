import type { TitlePick } from './catalog/MetaDetails'
import type { MetaType } from './catalog/tmdb'

/**
 * O que a pessoa assistiu por ultimo, e onde parou.
 *
 * Um registro por titulo (filme ou serie), com a fonte exata que tocou — e e
 * isso que deixa "Continuar" comecar direto, sem a lista de fontes de novo.
 * Fica so neste navegador, como a biblioteca: nao ha conta nem servidor que
 * precise saber o que alguem assiste.
 */
const KEY = 'ss.recents.v1'
const ROOM_KEY = (roomId: string) => `ss.recent-room.${roomId}`
const RESUME_KEY = (roomId: string) => `ss.resume-at.${roomId}`
const LIMIT = 40
const EVENT = 'ss-recents'
/** Faltando menos que isto (ou passado deste ponto), conta como visto. */
const FINISH_TAIL_MS = 4 * 60_000
const FINISH_RATIO = 0.94

export interface RecentEntry {
  /** `${type}:${id}` do alvo das fontes (o id do IMDb quando existe). */
  key: string
  type: MetaType
  /** Para reabrir a pagina do titulo no catalogo. */
  catalogId: string
  name: string
  poster: string
  background: string
  season?: number
  episode?: number
  pick: TitlePick
  positionMs: number
  durationMs: number
  updatedAt: number
}

export function recentKey(type: MetaType, id: string): string {
  return `${type}:${id}`
}

export function readRecents(): RecentEntry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    if (!Array.isArray(value)) return []
    return value.filter((entry): entry is RecentEntry => (
      typeof entry === 'object' && entry !== null &&
      typeof entry.key === 'string' && typeof entry.name === 'string' &&
      typeof entry.positionMs === 'number' && typeof entry.updatedAt === 'number' &&
      typeof entry.pick === 'object' && entry.pick !== null &&
      typeof entry.pick.stream === 'object' && typeof entry.pick.target === 'object'
    )).sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

function write(entries: RecentEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, LIMIT)))
  } catch {}
  try { window.dispatchEvent(new Event(EVENT)) } catch {}
}

export function subscribeRecents(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => { if (event.key === KEY) listener() }
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function recentFor(type: MetaType, ids: Array<string | null | undefined>): RecentEntry | null {
  const keys = new Set(ids.filter((id): id is string => Boolean(id)).map((id) => recentKey(type, id)))
  return readRecents().find((entry) => keys.has(entry.key) || keys.has(recentKey(type, entry.catalogId))) ?? null
}

export function isFinished(entry: Pick<RecentEntry, 'positionMs' | 'durationMs'>): boolean {
  if (entry.durationMs <= 0) return false
  return entry.positionMs >= entry.durationMs * FINISH_RATIO || entry.durationMs - entry.positionMs <= FINISH_TAIL_MS
}

/**
 * Uma sala comecou a tocar `pick`. Se e o mesmo episodio (ou o mesmo filme)
 * que ja estava registrado, a posicao antiga fica — e ela que o "Continuar"
 * usa; outro episodio comeca do zero.
 */
export function rememberStart(roomId: string, pick: TitlePick, resumeAtMs = 0): void {
  const key = recentKey(pick.target.type, pick.target.id)
  const entries = readRecents()
  const previous = entries.find((entry) => entry.key === key)
  const sameItem = previous && previous.season === pick.target.season && previous.episode === pick.target.episode
  const entry: RecentEntry = {
    key,
    type: pick.target.type,
    catalogId: pick.catalog?.id ?? previous?.catalogId ?? pick.target.id,
    name: pick.metaName || pick.displayName,
    poster: pick.poster || previous?.poster || '',
    background: pick.catalog?.background || previous?.background || '',
    season: pick.target.season,
    episode: pick.target.episode,
    pick,
    positionMs: resumeAtMs || (sameItem ? previous.positionMs : 0),
    durationMs: sameItem ? previous.durationMs : 0,
    updatedAt: Date.now(),
  }
  write([entry, ...entries.filter((other) => other.key !== key)])
  try {
    localStorage.setItem(ROOM_KEY(roomId), key)
    if (resumeAtMs > 0) localStorage.setItem(RESUME_KEY(roomId), String(Math.round(resumeAtMs)))
    else localStorage.removeItem(RESUME_KEY(roomId))
  } catch {}
}

/** A sala diz onde esta. Ignora o comeco (abrir e fechar nao vira "recente" com 0:03). */
export function notePosition(roomId: string, positionMs: number, durationMs: number): void {
  let key: string | null = null
  try { key = localStorage.getItem(ROOM_KEY(roomId)) } catch {}
  if (!key || !Number.isFinite(positionMs) || positionMs < 0) return
  const entries = readRecents()
  const entry = entries.find((candidate) => candidate.key === key)
  if (!entry) return
  const duration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : entry.durationMs
  if (Math.abs(entry.positionMs - positionMs) < 1_000 && duration === entry.durationMs) return
  write([{ ...entry, positionMs, durationMs: duration, updatedAt: Date.now() }, ...entries.filter((other) => other.key !== key)])
}

/** A posicao para onde a sala recem-aberta deve pular; lida uma vez so. */
export function takeResumeAt(roomId: string): number {
  try {
    const value = Number(localStorage.getItem(RESUME_KEY(roomId)))
    localStorage.removeItem(RESUME_KEY(roomId))
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

export function forgetRecent(key: string): void {
  write(readRecents().filter((entry) => entry.key !== key))
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

export function episodeLabel(entry: Pick<RecentEntry, 'season' | 'episode'>): string {
  return entry.season != null && entry.episode != null ? `T${entry.season}:E${entry.episode}` : ''
}
