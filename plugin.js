/**
 * Torrentio as a juntos.lol source plugin.
 *
 * juntos.lol resolves sources through plugins that run in a hardened Web
 * Worker: no `fetch`, no `navigator`, no `location`, no `eval`, no
 * WebAssembly, and no network except `api.fetch`, which the page performs on
 * the plugin's behalf and only against the hosts this manifest declares.
 *
 * Torrentio speaks the Stremio stream protocol and so does juntos.lol, so the
 * addon's answer is handed back nearly untouched: release names, sizes,
 * seeders and language flags are parsed on the other side, in
 * `web/src/catalog/streams.ts`, where that parsing is tested. What this file
 * adds over a bare one-line proxy is the part the other side cannot do —
 * choosing the upstream, surviving one that is down, and staying inside the
 * budget the runtime gives a resolution.
 *
 * Budget, as enforced by the host (web/src/plugins/runtime.ts): 15 seconds and
 * 32 `api.fetch` calls per resolution, whichever runs out first, after which
 * the worker is killed and this plugin counts as failed for that title. Each
 * hop through the server (internal/httpapi/pluginfetch.go) may itself take up
 * to 10 seconds. Both numbers are why SOURCES are raced against a deadline
 * that expires before the host's does: a partial answer is worth more than a
 * dead worker.
 */

export const manifest = {
  id: 'torrentio-brazuca',
  name: 'Torrentio + Brazuca',
  version: '2.0.0',
  // Every host this plugin may ever reach. The page compares the hostname of
  // each request against this list by exact equality, on the URL asked for and
  // again on the URL the answer came from, so a host added to PROVIDERS later
  // must be added here too — and adding one holds the update until whoever
  // installed the plugin approves the new host by name.
  hosts: [
    'torrentio.strem.fun',
    'torrentio.elfhosted.com',
    '94c8cb9f702d-brazuca-torrents.baby-beamup.club',
  ],
  updateUrl: 'https://github.com/guilhepinheiro1701-create/juntos.lol-torrent',
}

/**
 * Torrentio's options, spelled the way its own configure page spells them and
 * joined into one path segment.
 *
 * `providers` is listed explicitly because the Brazilian trackers — `comando`
 * and `bludv` — are not in Torrentio's default set, and a Brazilian watch
 * party without them is missing most of what it wants. The rest of the list is
 * Torrentio's default, restated so that naming the two does not silently drop
 * the others.
 *
 * A wrong key here does not break the plugin: an upstream that rejects the
 * configured path is asked again without it (see `ask`).
 */
const TORRENTIO_CONFIG = [
  'providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex,comando,bludv',
  'language=portuguese',
  'sort=qualitysize',
  'qualityfilter=scr,cam,unknown',
  'limit=20',
].join('|')

/**
 * Who to ask. Every entry speaks the Stremio stream protocol —
 * `/stream/{type}/{id}.json` — which is what makes this a bridge and not a
 * client of any one addon.
 *
 * `mirrors` and the provider list are asked differently on purpose. Mirrors of
 * one addon hold the same catalogue, so they are tried **in order until one
 * answers**: asking a second would spend a request to produce duplicates.
 * Different addons hold different catalogues, so providers are asked **all at
 * once and merged**: that is the whole reason to have more than one.
 *
 * The order here is the order on screen. juntos.lol filters the list by
 * resolution and by language flag, but it never reorders it — whatever this
 * function returns is what a viewer reads top to bottom.
 */
const PROVIDERS = [
  // First, because dubbed and legendado releases are what a Brazilian watch
  // party is looking for, and Torrentio's own results are a long tail of
  // English ones. Anyone who wants it the other way has the language filter.
  {
    name: 'Brazuca Torrents',
    mirrors: [
      // Brazilian trackers — BaixaFilmes, RedeTorrent, VacaTorrent. The addon
      // takes no options, so there is no configured path to try first.
      { base: 'https://94c8cb9f702d-brazuca-torrents.baby-beamup.club', config: null },
    ],
  },
  {
    name: 'Torrentio',
    mirrors: [
      { base: 'https://torrentio.strem.fun', config: TORRENTIO_CONFIG },
      // ElfHosted's own deployment of Torrentio, which they run as
      // KnightCrawler: same code and same URL grammar, its own index. It earns
      // its place as the fallback because the main instance refuses datacenter
      // address ranges, and every request from this plugin leaves from the
      // juntos.lol server, which is on one. (The other remedy lives on the
      // server: `PLUGIN_FETCH_PROXY`.)
      { base: 'https://torrentio.elfhosted.com', config: TORRENTIO_CONFIG },
    ],
  },
]

/** Under the host's 15s, with room left for the worker to post the answer back. */
const RUN_BUDGET_MS = 12_000

/**
 * Under the server hop's 10s, and small enough that a provider can spend it
 * on every one of its mirrors and still finish inside RUN_BUDGET_MS.
 */
const ATTEMPT_MS = 5_000

const TYPES = new Set(['movie', 'series'])

/** Rejects anything that could leave the path segment it is interpolated into. */
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/

const timeout = Symbol('timeout')

/**
 * Resolves to `timeout` instead of rejecting, because a slow upstream is a
 * result — "nothing from here" — and not an error to propagate. The timer is
 * cleared on the winning path so a fast answer does not leave one armed: the
 * worker is killed at the end of the run either way, but a plugin that relies
 * on that to tidy up is a plugin that breaks the day it is reused.
 */
function withDeadline(promise, ms) {
  let timer
  const expiry = new Promise((resolve) => { timer = setTimeout(() => resolve(timeout), ms) })
  return Promise.race([promise, expiry]).finally(() => { clearTimeout(timer) })
}

/** `tt0111161`, or `tt0111161:1:2` for one episode. */
function streamId(target) {
  // The typeof is not redundant with the pattern: `SAFE_ID.test(undefined)`
  // tests the string "undefined", which matches, and a missing id would sail
  // through to become a path segment.
  if (typeof target.id !== 'string' || !SAFE_ID.test(target.id)) throw new Error('unusable id')
  if (target.type !== 'series') return target.id
  const season = Number(target.season)
  const episode = Number(target.episode)
  if (!Number.isInteger(season) || !Number.isInteger(episode) || season < 0 || episode < 0) {
    throw new Error('series target without a season and episode')
  }
  return `${target.id}:${season}:${episode}`
}

/**
 * One request. Returns the stream array, or null when the answer was not one —
 * a status the upstream refused, a body that is not JSON, an object with no
 * `streams` key at all. Null is what makes the caller try the bare path: an
 * empty `streams` array is an answer ("no sources"), a missing one is not.
 */
async function fetchStreams(api, url) {
  const response = await api.fetch(url)
  if (!response.ok) return null
  let body
  try {
    body = await response.json()
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null) return null
  return Array.isArray(body.streams) ? body.streams : null
}

/**
 * One mirror, configured path first and bare path as the fallback. The retry
 * is what keeps a drifted option key from taking the mirror down with it:
 * worst case Torrentio answers unfiltered, which is worse than configured and
 * far better than nothing. A mirror with no options skips straight to bare.
 */
async function ask(api, mirror, type, id) {
  const bare = `${mirror.base}/stream/${type}/${id}.json`
  if (mirror.config) {
    const configured = await fetchStreams(api, `${mirror.base}/${mirror.config}/stream/${type}/${id}.json`)
    if (configured !== null) return configured
  }
  return (await fetchStreams(api, bare)) ?? []
}

/** Same torrent from two providers is one row; the first spelling of it wins. */
function dedupe(streams) {
  const seen = new Set()
  const out = []
  for (const stream of streams) {
    if (typeof stream !== 'object' || stream === null) continue
    const key = typeof stream.infoHash === 'string'
      ? `${stream.infoHash.toLowerCase()}:${stream.fileIdx ?? ''}`
      : typeof stream.url === 'string' ? `url:${stream.url}` : null
    if (key === null || seen.has(key)) continue
    seen.add(key)
    out.push(stream)
  }
  return out
}

/**
 * One provider: its mirrors in order, stopping at the first that gives
 * something. A mirror that times out or answers empty gave nothing, so the
 * next is tried either way — while the run still has time to try it.
 */
async function askProvider(api, provider, type, id, remaining) {
  for (const mirror of provider.mirrors) {
    const budget = remaining()
    if (budget <= 0) break
    const result = await withDeadline(ask(api, mirror, type, id), budget)
    if (result !== timeout && result.length > 0) return result
  }
  return []
}

export async function streams(target, api) {
  if (typeof target !== 'object' || target === null) throw new Error('no target')
  const { type } = target
  if (!TYPES.has(type)) throw new Error(`unsupported type: ${String(type)}`)
  const id = streamId(target)

  // One clock for the whole resolution, so that a provider working through its
  // mirrors cannot push the run past the budget the host allows it.
  const deadline = Date.now() + RUN_BUDGET_MS
  const remaining = () => Math.min(ATTEMPT_MS, deadline - Date.now())

  const answers = await Promise.all(
    PROVIDERS.map((provider) => askProvider(api, provider, type, id, remaining)),
  )
  // Concatenated in PROVIDERS order, because that order is what a viewer reads.
  return dedupe(answers.flat())
}
