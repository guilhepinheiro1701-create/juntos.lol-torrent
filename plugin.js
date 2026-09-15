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
  id: 'torrentio',
  name: 'Torrentio',
  version: '1.0.0',
  // Every host this plugin may ever reach. The page compares the hostname of
  // each request against this list by exact equality, on the URL asked for and
  // again on the URL the answer came from, so a mirror added to SOURCES later
  // must be added here too — and adding one holds the update until whoever
  // installed the plugin approves the new host by name.
  hosts: ['torrentio.strem.fun', 'torrentio.elfhosted.com'],
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
 * Where to ask, in order of preference. Each entry is a Stremio stream addon;
 * any addon speaking `/stream/{type}/{id}.json` fits here, which is what makes
 * this a bridge rather than a Torrentio client.
 *
 * The ElfHosted entry is the community mirror, and it earns its place: the
 * main instance refuses datacenter address ranges, and every request from this
 * plugin leaves from the juntos.lol server, which is on one. When that is the
 * problem, the mirror answers where the main instance did not. (The other
 * remedy lives on the server: `PLUGIN_FETCH_PROXY`.)
 */
const SOURCES = [
  { name: 'Torrentio', base: 'https://torrentio.strem.fun', config: TORRENTIO_CONFIG },
  { name: 'Torrentio (ElfHosted)', base: 'https://torrentio.elfhosted.com', config: TORRENTIO_CONFIG },
]

/**
 * 'fallback' asks the next source only when the previous one gave nothing,
 * which is the right shape for mirrors of one addon: they hold the same
 * catalogue, so merging them would spend requests to produce duplicates.
 *
 * 'merge' asks all of them at once and concatenates, deduplicated. Switch to
 * it when SOURCES stops being mirrors and becomes different addons.
 */
const MODE = 'fallback'

/** Under the host's 15s, with room left for the worker to post the answer back. */
const RUN_BUDGET_MS = 12_000

/** Under the server hop's 10s, so a hung upstream cannot eat the whole run. */
const ATTEMPT_MS = 5_500

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
 * One source, configured path first and bare path as the fallback. The retry
 * is what keeps a drifted option key from taking the source down with it:
 * worst case Torrentio answers unfiltered, which is worse than configured and
 * far better than nothing.
 */
async function ask(api, source, type, id) {
  const bare = `${source.base}/stream/${type}/${id}.json`
  if (source.config) {
    const configured = await fetchStreams(api, `${source.base}/${source.config}/stream/${type}/${id}.json`)
    if (configured !== null) return configured
  }
  return (await fetchStreams(api, bare)) ?? []
}

/** Same torrent from two sources is one row; the first spelling of it wins. */
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

export async function streams(target, api) {
  if (typeof target !== 'object' || target === null) throw new Error('no target')
  const { type } = target
  if (!TYPES.has(type)) throw new Error(`unsupported type: ${String(type)}`)
  const id = streamId(target)

  // One clock for the whole resolution, so that a source which spends its
  // attempt cannot push the run past the budget the host allows it.
  const deadline = Date.now() + RUN_BUDGET_MS
  const remaining = () => Math.min(ATTEMPT_MS, deadline - Date.now())

  if (MODE === 'merge') {
    const answers = await Promise.all(SOURCES.map(async (source) => {
      const result = await withDeadline(ask(api, source, type, id), remaining())
      return result === timeout ? [] : result
    }))
    return dedupe(answers.flat())
  }

  for (const source of SOURCES) {
    if (remaining() <= 0) break
    const result = await withDeadline(ask(api, source, type, id), remaining())
    // A source that timed out or answered empty is a source that gave nothing;
    // the next one is asked either way, while there is time to ask it.
    if (result !== timeout && result.length > 0) return dedupe(result)
  }
  return []
}
