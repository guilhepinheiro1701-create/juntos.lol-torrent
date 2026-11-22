/**
 * A barra do carregamento simples (modo basico).
 *
 * Abrir um torrent nao tem um "quanto falta" de verdade ate o enxame
 * responder, entao cada etapa anda numa faixa e desacelera perto do fim dela:
 * nunca chega aos 100 sozinha e nunca volta. A estimativa e a de uma abertura
 * tipica; passou do tipico, ela para de prometer numero.
 */
export type StartStage = 'search' | 'connect' | 'retry' | 'open'

// [comeco %, fim %, segundos tipicos]
const RANGE: Record<StartStage, [number, number, number]> = {
  search: [2, 15, 4],
  connect: [15, 70, 20],
  retry: [20, 70, 20],
  open: [70, 96, 8],
}
const AFTER: Record<StartStage, number> = {
  search: RANGE.connect[2] + RANGE.open[2],
  connect: RANGE.open[2],
  retry: RANGE.open[2],
  open: 0,
}

export function loadingProgress(stage: StartStage, secondsInStage: number): { pct: number; etaSeconds: number | null } {
  const [from, to, typical] = RANGE[stage]
  const seconds = Math.max(0, secondsInStage)
  const pct = Math.round(from + (to - from) * (1 - Math.exp(-seconds / (typical / 1.6))))
  const left = typical - seconds
  return { pct, etaSeconds: left > 0 ? Math.max(2, Math.round(left + AFTER[stage])) : null }
}
