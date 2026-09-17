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
  id: 'juntos-torrent-sources',
  name: 'Torrentio + Brazuca + Comet + MediaFusion',
  version: '4.3.0',
  // Every host this plugin may ever reach. The page compares the hostname of
  // each request against this list by exact equality, on the URL asked for and
  // again on the URL the answer came from, so a host added to PROVIDERS later
  // must be added here too — and adding one holds the update until whoever
  // installed the plugin approves the new host by name.
  hosts: [
    '94c8cb9f702d-brazuca-torrents.baby-beamup.club',
    'torrentio.strem.fun',
    'torrentio.elfhosted.com',
    'comet.elfhosted.com',
    'comet.feels.legal',
    'mediafusion.elfhosted.com',
    '27a5b2bfe3c0-stremio-brazilian-addon.baby-beamup.club',
    'torrent-indexer.darklyn.org',
    'v3-cinemeta.strem.io',
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
 * base64url, because the worker scope keeps `btoa` and this is the whole of
 * what an addon that wants JSON in a path segment needs: no padding, and the
 * two characters that would otherwise have to be percent-encoded swapped out.
 */
function base64url(value) {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Comet takes its settings as one path segment: base64url of a JSON object.
 * Plain base64 of plain JSON, not a signed or encrypted blob, so the plugin
 * builds it here instead of asking anyone to paste one.
 *
 * `debridService: 'torrent'` is Comet's direct-torrent mode: no debrid account,
 * and the answer is magnets rather than links into someone's cache — which is
 * the only shape juntos.lol can open anyway. `{}` (which encodes to `e30`)
 * also works and is the thing to try if a Comet version ever rejects this.
 */
const COMET_CONFIG = base64url({ debridService: 'torrent' })

/**
 * MediaFusion is the one this plugin cannot configure for you, and it is worth
 * saying why rather than leaving a long opaque string looking unexplained.
 *
 * Its settings travel either as an HTTP header (`encoded_user_data`) or as a
 * path segment. The header is out of reach: `api.fetch` takes a URL and
 * nothing else — no headers, no method, no body — because every request is
 * performed by the juntos.lol server on the plugin's behalf. And the path
 * segment is **encrypted with the instance's own SECRET_KEY** (AES-256), so it
 * cannot be constructed from outside: only that instance can mint one.
 *
 * So the one below was minted at https://mediafusion.elfhosted.com/configure
 * and pasted in. It carries catalogue, quality and language preferences and no
 * debrid account — which is the only reason it can live in a public file.
 * **A config generated with a debrid service selected carries that account's
 * API token inside it, and must never be committed here.** This repository has
 * to stay public for juntos.lol to install the plugin from it, so anything in
 * this file is published.
 *
 * Empty is also valid, and means asking anonymously. Either way the bare path
 * stays as the fallback, so a segment this instance stops accepting costs a
 * request rather than the provider.
 */
const MEDIAFUSION_CONFIG = 'D-3-608kLJEnktYCZcSiuvZIMiNNDrOYf7BWbYrM5LzlyqZYMVQ1ngmr9_3rF2aozyN7JmYyPiw2H33J11vWp2v8w6bkrW6f9l9kGIhpLm31fPwae3uqILuQApT0xToo4fGQAKu8p23hqjSz8t5dsT5X_jERG0fvOcOQGRW0WhrqjP2k7YLgs06SPDDTiBMRrJbzRNeP8u7k1yhMMyc4St1H_6WuupMh3eN98b-E2ngSGSqaPIEmE9647ibejzxV7PxXavlfDK5qstRE6G9PUk9GIee9FAJ-7HhOwaUhLJUliuTnqCTYaSXrNjrOQgG-gIockR9QV_nyYwoejbt3c8gmnCfDPonfqfKd9qYjZc9y4bxpqGkGpAJQz9zt1Qn15lamIlfwXFf1enLJQdaTQgexi9YHa6YoxQYZa3V2KljMhiBSsybcG1W70yXCwq6K6kVlzHYaR11GJcMsPi8zTlBNRWs2sKtVcBvazFiM1tThfbFLVVPlB9SX9PXbYT8xf3ZQNA0Fr3Ck2pTvvpD3v48hXf0r2Fz0fM4gThfCGrczELFitFCs1SU-N-hGriflKt8LRNVxYS2lb-ECs7oJNdbgFySGCUvhnSDzeSEtVKivgSWru1wki6oR90sWGOHwvGmQuLUC0mluI-DeMdNHYLROUJc_ZcG7pfjmMHlV-k5__beEVGqDCetHOdaIBvPQDAABm0_0_EPDgTnQqFAZ-L4vdvGV2AFIIq86rF_zE2xgZeXtPBTK6BkhvyTE9BVg2Vv_EZ9M3E55hCkADHLXDNcFqQ9jJ91pQKLFApPk75eJhIzvnQhZLnTnXVVq97ZSFZYemCa95OgzO-W4CorrB5DXVXgIWivkcOaFxLzDExDdVZVvfP_dZKt1PpmcUSpJQAMLkloTsA0Ok-u01MoDJhS-SZ_l0EjfcPYAwXk3RFylkn3wi5RH5l1nqtcFCLy-sxVftAWYqqCu9tZRJtlm-VDzSs-PRjBWtqeZhI9HkuSR2bt_JBnS6rhsY_CBYfycJp7kUuqGJdkLTC00MIxggxUg'

/**
 * felipemarinho97/torrent-indexer: a Go service that scrapes the Brazilian
 * release sites directly — bludv, comando, rede-torrent, vaca-torrent,
 * starck-filmes and torrent-dos-filmes — and serves the result as JSON. It is not a Stremio addon, so it needs a URL of
 * its own and an adapter on the way back.
 *
 * This is the author's public test instance. Point it at your own
 * (`docker compose up` on that repository) and you get its cache, its speed,
 * and no dependency on someone else's free server.
 */
const INDEXER_BASE = 'https://torrent-indexer.darklyn.org'

/** Where a title comes from, since the app hands a plugin an IMDb id and nothing else. */
const CINEMETA_BASE = 'https://v3-cinemeta.strem.io'

/**
 * The indexer searches by text, so the IMDb id has to become a title first.
 * One request, made once, before the providers that need it fan out.
 */
async function lookupTitle(api, type, imdbId) {
  const response = await api.fetch(`${CINEMETA_BASE}/meta/${type}/${imdbId}.json`)
  if (!response.ok) return null
  try {
    const meta = (await response.json())?.meta
    const name = typeof meta?.name === 'string' ? meta.name : ''
    return name === '' ? null : name
  } catch {
    return null
  }
}

const FLAGS = [
  [/portugu|pt-?br|dublado|nacional/i, '🇧🇷'],
  [/ingl|english/i, '🇺🇸'],
  [/espanhol|spanish/i, '🇪🇸'],
  [/japon|japanese/i, '🇯🇵'],
]

/**
 * One indexer result in the shape juntos.lol reads.
 *
 * `info_hash` is preferred when it is there; otherwise the magnet goes into
 * `url` and `normalize()` pulls the hash out of it later. Seeders, size and
 * the site name are written as the `👤 💾 ⚙️` markers because that is the only
 * place `parseStreamTitle` looks, and the audio tags become flag emojis on a
 * line of their own, which is how it finds languages.
 */
function fromIndexer(raw, site) {
  if (typeof raw !== 'object' || raw === null) return null
  const hash = typeof raw.info_hash === 'string' ? raw.info_hash : ''
  const magnet = typeof raw.magnet_link === 'string' ? raw.magnet_link : ''
  if (!/^[0-9a-f]{40}$/i.test(hash) && magnet === '') return null

  const label = [raw.title, raw.original_title].find((v) => typeof v === 'string' && v !== '') ?? 'sem título'
  const stats = []
  if (Number.isFinite(raw.seed_count)) stats.push(`👤 ${Math.trunc(raw.seed_count)}`)
  if (typeof raw.size === 'string' && raw.size !== '') stats.push(`💾 ${raw.size}`)
  stats.push(`⚙️ ${site}`)

  const audio = Array.isArray(raw.audio) ? raw.audio.map(String).join(' ') : ''
  const flags = FLAGS.filter(([pattern]) => pattern.test(audio)).map(([, flag]) => flag)

  const stream = {
    name: `Indexer\n${site}`,
    title: [label, stats.join(' '), flags.join(' / ')].filter((line) => line !== '').join('\n'),
  }
  return /^[0-9a-f]{40}$/i.test(hash) ? { ...stream, infoHash: hash.toLowerCase() } : { ...stream, url: magnet }
}

/** The indexer answers `{results, count}`, not `{streams}`. */
const indexerProvider = (site, label) => ({
  name: `Indexer · ${label}`,
  needsTitle: true,
  adapt: (body) => (Array.isArray(body.results)
    ? body.results.map((raw) => fromIndexer(raw, label)).filter((s) => s !== null)
    : null),
  mirrors: [{
    // Searching by title only. The indexer's `imdb=` and `year=` filters drop
    // every entry whose field the scraper could not fill — and it often cannot
    // — so they cost far more recall than the precision they buy.
    url: (ctx) => (ctx.title === ''
      ? null
      : `${INDEXER_BASE}/indexers/${site}?q=${encodeURIComponent(ctx.title)}&limit=20`),
  }],
})

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
  // party is looking for, and the others are a long tail of English ones.
  // Anyone who wants it the other way has the language filter.
  {
    name: 'Brazuca Torrents',
    mirrors: [
      // Brazilian trackers — BaixaFilmes, RedeTorrent, VacaTorrent. The addon
      // takes no options, so there is no configured path to try first.
      { base: 'https://94c8cb9f702d-brazuca-torrents.baby-beamup.club', config: null },
    ],
  },
  {
    // Movies only: the live manifest declares `types: ["movie"]`, so asking it
    // for an episode is a request spent to be told nothing. `types` here is
    // what keeps that from happening.
    name: 'Mico-Leão Dublado',
    types: ['movie'],
    mirrors: [
      { base: 'https://27a5b2bfe3c0-stremio-brazilian-addon.baby-beamup.club', config: null },
    ],
  },
  indexerProvider('bludv', 'BluDV'),
  indexerProvider('comando_torrents', 'Comando'),
  indexerProvider('rede_torrent', 'Rede Torrent'),
  indexerProvider('vaca_torrent', 'Vaca Torrent'),
  indexerProvider('starck-filmes', 'Starck Filmes'),
  indexerProvider('torrent-dos-filmes', 'Torrent dos Filmes'),
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
  {
    name: 'Comet',
    mirrors: [
      { base: 'https://comet.elfhosted.com', config: COMET_CONFIG },
      { base: 'https://comet.feels.legal', config: COMET_CONFIG },
    ],
  },
  {
    name: 'MediaFusion',
    mirrors: [
      // `config` empty means the bare path, which is the anonymous mode. See
      // MEDIAFUSION_CONFIG above for why it cannot be filled in from here.
      { base: 'https://mediafusion.elfhosted.com', config: MEDIAFUSION_CONFIG || null },
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
async function fetchStreams(api, url, adapt) {
  const response = await api.fetch(url)
  if (!response.ok) return null
  let body
  try {
    body = await response.json()
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null) return null
  return adapt(body)
}

/** What a Stremio addon answers with, and the default when a provider says nothing else. */
const stremioStreams = (body) => (Array.isArray(body.streams) ? body.streams : null)

/**
 * One mirror. A mirror with a `url` of its own builds it and that is the whole
 * request; the rest are Stremio addons, tried on the configured path first and
 * the bare path as the fallback. The retry is what keeps a drifted option key
 * from taking the mirror down with it: worst case the addon answers
 * unfiltered, which is worse than configured and far better than nothing.
 */
async function ask(api, provider, mirror, ctx) {
  const adapt = provider.adapt ?? stremioStreams
  if (mirror.url) {
    const url = mirror.url(ctx)
    return url === null ? [] : (await fetchStreams(api, url, adapt)) ?? []
  }
  const bare = `${mirror.base}/stream/${ctx.type}/${ctx.id}.json`
  if (mirror.config) {
    const configured = await fetchStreams(api, `${mirror.base}/${mirror.config}/stream/${ctx.type}/${ctx.id}.json`, adapt)
    if (configured !== null) return configured
  }
  return (await fetchStreams(api, bare, adapt)) ?? []
}

/**
 * Stremio deprecated `title` in favour of `description`, and the newer addons
 * moved: Comet and MediaFusion describe a release in `description` and leave
 * `title` unset. juntos.lol reads only `title` (`parseStreams` in
 * web/src/catalog/streams.ts), so those rows arrive with no release name, no
 * size, no seeder count and no language flags — and `streamResolution`, with
 * nothing to read, files every one of them under `sd`.
 *
 * Copying one field to the other is the whole fix, and it has to happen here
 * because the other side has no idea the field exists.
 */
function describe(stream) {
  const title = typeof stream.title === 'string' ? stream.title : ''
  const description = typeof stream.description === 'string' ? stream.description : ''
  if (description === '') return stream
  if (title === '') return { ...stream, title: description }
  if (title.includes('👤') || title.includes('💾')) return stream
  // A title that is only a release name, next to a description that carries the
  // numbers: take the marked lines and leave the prose, so the label does not
  // end up saying the same thing twice.
  const marked = description.split('\n').filter((line) => /👤|💾|⚙️/.test(line))
  return marked.length === 0 ? stream : { ...stream, title: `${title}\n${marked.join(' ')}` }
}

/** Binary units, and the spelling `parseStreamTitle` knows how to read back. */
function humanSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  return `${unit === 0 ? value : value.toFixed(2)} ${units[unit]}`
}

/**
 * Folds seeder count and size into the title, where the app looks for them.
 *
 * Mico-Leão Dublado carries both as top-level fields — `seeders` and `size` in
 * its stream model — while `parseStreamTitle` only ever reads the `👤` and `💾`
 * markers out of the title text. So the numbers are right there in the payload
 * and the row still renders without them, which is also what keeps `seeded()`
 * from being able to tell a dead torrent from a quiet one.
 */
function stats(stream) {
  const title = typeof stream.title === 'string' ? stream.title : ''
  if (title.includes('👤') || title.includes('💾')) return stream
  const hints = typeof stream.behaviorHints === 'object' && stream.behaviorHints !== null
    ? stream.behaviorHints
    : {}
  const bytes = [stream.size, hints.videoSize].find((v) => Number.isFinite(v) && v > 0)
  const parts = []
  if (Number.isFinite(stream.seeders)) parts.push(`👤 ${Math.trunc(stream.seeders)}`)
  if (bytes !== undefined) parts.push(`💾 ${humanSize(bytes)}`)
  if (parts.length === 0) return stream
  return { ...stream, title: title === '' ? parts.join(' ') : `${title}\n${parts.join(' ')}` }
}

/**
 * `👤 0`, written out. Only a count that is actually legible counts: a stream
 * that never says is never dropped.
 */
const SEEDERS = /👤\s*(\d+)/

/**
 * Drops a torrent that says, in its own description, that nobody is seeding it.
 *
 * juntos.lol reads torrent bytes from the swarm. No peers means no bytes, and
 * what the host sees is not "no seeders" but a remux that dies on the first
 * read — `Error: Assertion failed.` out of the parser, zero tracks, zero
 * duration. That failure is indistinguishable, on screen, from a corrupt file.
 *
 * This matters most for Comet, which without a debrid account answers from
 * cache indexes: hashes that a debrid service holds, which is not the same as
 * hashes the open swarm still carries.
 */
function seeded(stream) {
  const count = SEEDERS.exec(typeof stream.title === 'string' ? stream.title : '')
  return count === null || Number(count[1]) > 0
}

const MAGNET_BTIH = /^magnet:\?.*\bxt=urn:btih:([0-9a-fA-F]{40})\b/

/**
 * Turns a stream juntos.lol would drop into one it can open, where that is
 * only a matter of spelling.
 *
 * `readLocation` in web/src/catalog/streams.ts takes a 40-hex `infoHash` or an
 * `https:` `url`, and nothing else — so a `url` holding a `magnet:` URI, which
 * is how Comet and MediaFusion hand back a torrent when no debrid account is
 * configured, is thrown away without a word. The infohash is right there in
 * the URI; moving it to the field the app reads is the whole fix.
 *
 * Only the 40-hex form is converted. A base32 infohash would need decoding to
 * bytes and back to hex, and it is rare enough not to be worth carrying.
 */
function normalize(stream) {
  if (typeof stream.infoHash === 'string' || typeof stream.url !== 'string') return stream
  const magnet = MAGNET_BTIH.exec(stream.url)
  if (!magnet) return stream
  const { url, ...rest } = stream
  return { ...rest, infoHash: magnet[1].toLowerCase() }
}

/**
 * Stamps the provider onto a stream that did not name its own source.
 *
 * The app reads the source from the `⚙️` marker, and only on the line that
 * also carries `👤` or `💾` — `parseStreamTitle` finds the stats line first and
 * reads everything else out of it. So when an addon gives no numbers at all,
 * the marker needs a line of its own with a bare `💾` on it: the size pattern
 * wants digits and finds none, which leaves the size empty and the source set.
 *
 * Worth the trouble because a row that cannot say where it came from is a row
 * nobody can debug — including me, looking at a screenshot of it.
 */
function attribute(stream, provider) {
  const title = typeof stream.title === 'string' ? stream.title : ''
  if (title.includes('⚙️')) return stream
  const lines = title === '' ? [] : title.split('\n')
  const at = lines.findIndex((line) => line.includes('👤') || line.includes('💾'))
  if (at >= 0) lines[at] = `${lines[at]} ⚙️ ${provider}`
  else lines.push(`💾 ⚙️ ${provider}`)
  return { ...stream, title: lines.join('\n') }
}

/**
 * Codecs the juntos.lol worker cannot plan, spelled the way release names
 * spell them.
 *
 * The worker builds its FFmpeg plan from an `audio_action` matrix that knows
 * aac, ac3, eac3, dts, dca, opus, flac, mp3 and vorbis — and **not truehd**.
 * Its own test says so (`refuses_unlisted_codecs_clearly`, in
 * ss-worker/ss-remux/src/plan.rs). One unlisted track kills the whole plan,
 * because the matrix is consulted per stream with `?`: a release whose
 * Portuguese dub is plain AC-3 still fails when the original track is TrueHD.
 *
 * What the host sees when that happens is "remote remux failed" with no
 * reason, after minutes of downloading — the server keeps the real message in
 * its own log. Dropping these here costs a row nobody could have played and
 * saves that whole trip.
 *
 * DTS is deliberately not on this list: the matrix takes it and converts.
 */
const UNPLAYABLE_AUDIO = /\btrue[\s._-]?hd\b|\batmos\b/i

/** False when the release name says it carries audio the worker will refuse. */
function preparable(stream) {
  return !UNPLAYABLE_AUDIO.test(typeof stream.title === 'string' ? stream.title : '')
}

/** Everything one raw stream goes through, or null when it is not usable. */
function refine(raw, provider) {
  if (typeof raw !== 'object' || raw === null) return null
  const stream = normalize(attribute(stats(describe(raw)), provider))
  return seeded(stream) && preparable(stream) ? stream : null
}

/** Same torrent from two providers is one row; the first spelling of it wins. */
function dedupe(streams) {
  const seen = new Set()
  const out = []
  for (const stream of streams) {
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
async function askProvider(api, provider, ctx, remaining) {
  for (const mirror of provider.mirrors) {
    const budget = remaining()
    if (budget <= 0) break
    const result = await withDeadline(ask(api, provider, mirror, ctx), budget)
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

  const asking = PROVIDERS.filter((provider) => !provider.types || provider.types.includes(type))

  // The indexers search by text, and a plugin is handed an IMDb id and nothing
  // else. One lookup, before the fan-out, shared by every provider that needs
  // it — and only paid for when one of them is in play.
  const title = asking.some((provider) => provider.needsTitle) && remaining() > 0
    ? await withDeadline(lookupTitle(api, type, target.id), remaining())
    : null
  const ctx = { type, id, title: typeof title === 'string' ? title : '' }

  const answers = await Promise.all(asking.map(async (provider) => {
    const found = await askProvider(api, provider, ctx, remaining)
    return found.map((raw) => refine(raw, provider.name)).filter((stream) => stream !== null)
  }))
  // Concatenated in PROVIDERS order, because that order is what a viewer reads.
  return dedupe(answers.flat())
}
