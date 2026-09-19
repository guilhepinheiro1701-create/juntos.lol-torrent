import { useSyncExternalStore } from 'react'
import { playJLocalChime } from '../ui/chime'

// The companion app's fixed loopback origin. One port, never scanned:
// the web UI probes exactly this, and the app refuses to hop.
export const JLOCAL_ORIGIN = 'http://127.0.0.1:40392'
const PROBE_TIMEOUT_MS = 1500
const POLL_MS = 10000
// Quem não tem o jlocal instalado — que é o caso de quem roda tudo na própria
// máquina — via uma linha vermelha no console a cada dez segundos, para sempre.
// Centenas delas escondem os erros que importam. Depois de algumas tentativas
// sem resposta, o intervalo cresce; uma resposta devolve o ritmo normal.
const BACKOFF_AFTER = 3
const MAX_POLL_MS = 5 * 60 * 1000

export interface JLocalSnapshot {
  connected: boolean
  version: string | null
  connecting: boolean
  modalOpen: boolean
}

const initial: JLocalSnapshot = { connected: false, version: null, connecting: false, modalOpen: false }
let snapshot: JLocalSnapshot = initial
const listeners = new Set<() => void>()
let pollTimer: ReturnType<typeof setTimeout> | null = null
let polling = false
let probeEpoch = 0
let misses = 0

function emit(next: JLocalSnapshot): void {
  snapshot = next
  for (const listener of listeners) listener()
}

async function probeVersion(signal: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch(`${JLOCAL_ORIGIN}/health`, { signal })
    if (!response.ok) return null
    const body = (await response.json()) as { name?: unknown; version?: unknown }
    return body?.name === 'jlocal' && typeof body.version === 'string' ? body.version : null
  } catch {
    return null
  }
}

async function refresh(manual: boolean): Promise<void> {
  const epoch = ++probeEpoch
  if (manual) emit({ ...snapshot, connecting: true })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  let version: string | null = null
  try {
    version = await probeVersion(controller.signal)
  } finally {
    clearTimeout(timer)
  }
  if (epoch !== probeEpoch) return
  const was = snapshot.connected
  const connected = version !== null
  misses = connected ? 0 : misses + 1
  emit({ ...snapshot, connected, version, connecting: false })
  if (connected && !was) playJLocalChime()
}

/** Dez segundos enquanto vale a pena perguntar; depois, o dobro a cada falha. */
function nextDelay(): number {
  if (misses <= BACKOFF_AFTER) return POLL_MS
  return Math.min(MAX_POLL_MS, POLL_MS * 2 ** (misses - BACKOFF_AFTER))
}

// `polling` e nao `pollTimer !== null`: entre o disparo e o reagendamento o
// timer e nulo, e um assinante que chegasse nessa fresta abriria uma segunda
// corrente perguntando em paralelo com a primeira.
function ensurePolling(): void {
  if (polling) return
  polling = true
  const tick = () => {
    pollTimer = setTimeout(() => {
      void refresh(false).finally(() => {
        pollTimer = null
        if (listeners.size > 0) tick()
        else polling = false
      })
    }, nextDelay())
    const unref = (pollTimer as unknown as { unref?: () => void }).unref
    if (typeof unref === 'function') unref.call(pollTimer)
  }
  tick()
}

export function subscribeJLocal(listener: () => void): () => void {
  listeners.add(listener)
  ensurePolling()
  void refresh(false)
  return () => { listeners.delete(listener) }
}

export function getJLocalSnapshot(): JLocalSnapshot {
  return snapshot
}

/** Manual attempt from the "Connect to J Local" button. Never throws. */
export function connectJLocal(): void {
  // Pedir à mão zera a espera: a pessoa acabou de dizer que ele deve estar lá.
  misses = 0
  void refresh(true)
}

export function setJLocalModal(open: boolean): void {
  if (snapshot.modalOpen !== open) emit({ ...snapshot, modalOpen: open })
}

/** Test-only reset for the module singleton. */
export function resetJLocalForTests(): void {
  probeEpoch += 1
  snapshot = initial
  misses = 0
  polling = false
  if (pollTimer !== null) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

export function useJLocal(): JLocalSnapshot & { connect: () => void; setModal: (open: boolean) => void } {
  const snap = useSyncExternalStore(subscribeJLocal, getJLocalSnapshot, getJLocalSnapshot)
  return { ...snap, connect: connectJLocal, setModal: setJLocalModal }
}
