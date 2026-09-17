import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import {
  ALLOWED, MAX_REQUESTS, RUN_TIMEOUT_MS,
  assertManifest, canonicalRepoUrl, checkFetchUrl, loadPlugin, makeApi, plain, survivingGlobals,
} from './sandbox.js'

const PLUGIN = fileURLToPath(new URL('../plugin.js', import.meta.url))

const BRAZUCA = '94c8cb9f702d-brazuca-torrents.baby-beamup.club'
const TORRENTIO = 'torrentio.strem.fun'
const ELFHOSTED = 'torrentio.elfhosted.com'
const COMET = 'comet.elfhosted.com'
const COMET_MIRROR = 'comet.feels.legal'
const MEDIAFUSION = 'mediafusion.elfhosted.com'
const MICOLEAO = '27a5b2bfe3c0-stremio-brazilian-addon.baby-beamup.club'
const INDEXER = 'torrent-indexer.darklyn.org'
const CINEMETA = 'v3-cinemeta.strem.io'

const MOVIE = { type: 'movie', id: 'tt0111161' }
const EPISODE = { type: 'series', id: 'tt0903747', season: 5, episode: 14 }

const torrent = (hash, extra = {}) => ({
  name: 'Torrentio\n1080p',
  title: `Release.1080p.BluRay\n👤 842 💾 2.1 GB ⚙️ ThePirateBay\n🇧🇷 / 🇺🇸`,
  infoHash: hash.repeat(40).slice(0, 40),
  fileIdx: 0,
  behaviorHints: { filename: 'release.1080p.mkv' },
  ...extra,
})

const FROM_BRAZUCA = torrent('a')
const FROM_TORRENTIO = torrent('b')

const body = (streams) => ({ status: 200, body: JSON.stringify({ streams }) })

/**
 * Routes by hostname. A host left out answers an empty list rather than 404,
 * so that "this one had nothing" costs one request and does not drag the
 * bare-path retry into a count the test is trying to assert.
 */
const answers = (map) => (url) => map[new URL(url).hostname] ?? body([])

/** Cinemeta's reply, which is what turns an IMDb id into a searchable title. */
const named = (name) => ({ status: 200, body: JSON.stringify({ meta: { name } }) })

/** Hosts that speak the Stremio stream protocol — everything but the lookup. */
const addonHosts = (calls) => calls.filter((url) => !url.includes(CINEMETA))

const hostsOf = (calls) => calls.map((url) => new URL(url).hostname)

async function load(options) {
  const { namespace, context, source } = await loadPlugin(PLUGIN, options)
  return { plugin: namespace, context, source }
}

describe('manifest', () => {
  it('satisfies every rule the app applies at install', async () => {
    const { plugin } = await load()
    assert.deepEqual(assertManifest(plugin.manifest), [])
  })

  it('locks its identity to this repository', async () => {
    const { plugin } = await load()
    assert.equal(
      canonicalRepoUrl(plugin.manifest.updateUrl),
      'https://github.com/guilhepinheiro1701-create/juntos.lol-torrent',
    )
  })

  it('declares every host it will ever reach', async () => {
    const { plugin, source } = await load()
    const reachable = [...source.matchAll(/https:\/\/([a-z0-9.-]+)/g)]
      .map((match) => match[1])
      .filter((host) => host !== 'github.com')
    for (const host of new Set(reachable)) {
      assert.ok(plugin.manifest.hosts.includes(host), `${host} is used but not declared`)
    }
  })
})

describe('the box it runs in', () => {
  it('evaluates with no global outside the allowlist left standing', async () => {
    const { context } = await load()
    const leaked = survivingGlobals(context).filter((name) => !ALLOWED.has(name))
    assert.deepEqual(leaked, [], `these globals survived the trim: ${leaked.join(', ')}`)
  })

  it('imports nothing and touches no network while being read', async () => {
    // The app reads the manifest by evaluating the module in this same box with
    // an empty host list. Anything the top level reaches for fails there.
    const { plugin } = await load()
    assert.equal(typeof plugin.streams, 'function')
    assert.equal(typeof plugin.manifest, 'object')
  })

  it('stays inside the run budget the host allows', async () => {
    const { source } = await load()
    const run = Number(/RUN_BUDGET_MS = ([\d_]+)/.exec(source)[1].replace(/_/g, ''))
    const attempt = Number(/ATTEMPT_MS = ([\d_]+)/.exec(source)[1].replace(/_/g, ''))
    assert.ok(run < RUN_TIMEOUT_MS, `${run}ms leaves nothing before the host's ${RUN_TIMEOUT_MS}ms`)
    // A provider may spend one attempt on each of its mirrors; the deepest
    // provider must still finish inside the run.
    assert.ok(attempt * 2 <= run, 'two mirrors in a row must fit inside the run')
  })
})

describe('resolving a title', () => {
  it('asks every provider and hands every stream back', async () => {
    const { plugin } = await load()
    const { api, calls } = makeApi(plugin.manifest.hosts, answers({
      [BRAZUCA]: body([FROM_BRAZUCA]),
      [TORRENTIO]: body([FROM_TORRENTIO]),
      [COMET]: body([torrent('c')]),
      [MEDIAFUSION]: body([torrent('d')]),
      [MICOLEAO]: body([torrent('e')]),
    }))
    const streams = plain(await plugin.streams(MOVIE, api))

    assert.equal(streams.length, 5)
    // One request per provider, no reason to have touched either mirror, and
    // one lookup — which came back without a name, so the indexers, which have
    // nothing to search with, were never asked.
    assert.deepEqual(hostsOf(calls).sort(), [
      BRAZUCA, CINEMETA, COMET, MEDIAFUSION, MICOLEAO, TORRENTIO,
    ].sort())
  })

  it('puts Brazuca first, because that is the order on screen', async () => {
    // juntos.lol filters this list but never sorts it, so the plugin's order
    // is what a viewer reads top to bottom.
    const { plugin } = await load()
    const { api } = makeApi(plugin.manifest.hosts, answers({
      [BRAZUCA]: body([FROM_BRAZUCA]),
      [TORRENTIO]: body([FROM_TORRENTIO]),
    }))

    assert.equal(plain(await plugin.streams(MOVIE, api))[0].infoHash, FROM_BRAZUCA.infoHash)
  })

  it('addresses an episode as id:season:episode everywhere it asks', async () => {
    const { plugin } = await load()
    const { api, calls } = makeApi(plugin.manifest.hosts, answers({}))
    await plugin.streams(EPISODE, api)

    const asked = addonHosts(calls)
    assert.ok(asked.length > 0)
    for (const url of asked) {
      assert.ok(url.endsWith('/stream/series/tt0903747:5:14.json'), url)
    }
  })

  it('configures Torrentio and leaves Brazuca bare', async () => {
    const { plugin } = await load()
    const { api, calls } = makeApi(plugin.manifest.hosts, answers({}))
    await plugin.streams(MOVIE, api)

    const config = new URL(calls.find((url) => url.includes(TORRENTIO))).pathname.split('/')[1]
    assert.match(config, /providers=/)
    assert.match(config, /bludv/, 'the Brazilian trackers are the reason the config exists')
    assert.match(config, /language=portuguese/)

    // Brazuca takes no options, so a config segment would only be a 404 to
    // recover from.
    const brazuca = new URL(calls.find((url) => url.includes(BRAZUCA)))
    assert.equal(brazuca.pathname, '/stream/movie/tt0111161.json')
  })

})

describe('configuring the ones that take configuration', () => {
  it('builds Comet its base64url settings segment', async () => {
    const { plugin } = await load()
    const { api, calls } = makeApi(plugin.manifest.hosts, answers({}))
    await plugin.streams(MOVIE, api)

    const segment = new URL(calls.find((url) => url.includes(COMET))).pathname.split('/')[1]
    assert.doesNotMatch(segment, /[+/=]/, 'base64url, not base64')
    const decoded = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
    assert.equal(decoded.debridService, 'torrent', 'no debrid account means torrent mode')
  })

  it('sends MediaFusion the config segment minted for this instance', async () => {
    // Its settings are either an HTTP header — and api.fetch sends none — or a
    // path segment encrypted with the instance's own key. The segment below
    // was generated at /configure and pasted in; it cannot be built here.
    const { plugin } = await load()
    const { api, calls } = makeApi(plugin.manifest.hosts, answers({}))
    await plugin.streams(MOVIE, api)

    const [configured] = calls.filter((url) => url.includes(MEDIAFUSION))
    const segment = new URL(configured).pathname.split('/')[1]
    assert.match(segment, /^[A-Za-z0-9_-]+$/, 'base64url, safe in a path segment')
    assert.ok(segment.length > 100, 'an encrypted blob, not a stray word')
  })

  it('carries no debrid token into a file that gets published', async () => {
    // The repository has to stay public for juntos.lol to install from it. A
    // MediaFusion config generated with a debrid service selected holds that
    // account's API token, so nothing that looks like a loose key belongs here.
    const { source } = await load()
    for (const pattern of [/realdebrid\s*[:=]/i, /torbox/i, /alldebrid/i, /premiumize/i, /api[_-]?key\s*[:=]\s*['"][^'"]+/i]) {
      assert.doesNotMatch(source, pattern, `${pattern} has no business in a published plugin`)
    }
  })

  it('keeps the bare path as the MediaFusion fallback', async () => {
    const { plugin } = await load()
    const { api, calls } = makeApi(plugin.manifest.hosts, (url) => {
      const { hostname, pathname } = new URL(url)
      if (hostname !== MEDIAFUSION) return body([])
      return pathname === '/stream/movie/tt0111161.json' ? body([torrent('f')]) : { status: 400, body: 'Bad Request' }
    })
    const streams = plain(await plugin.streams(MOVIE, api))

    assert.equal(streams.length, 1, 'a rejected segment costs a request, not the provider')
    assert.equal(calls.filter((url) => url.includes(MEDIAFUSION)).length, 2)
  })
})

describe('streams that arrive as magnets', () => {
  it('moves the infohash to the field the app actually reads', async () => {
    // readLocation in web/src/catalog/streams.ts takes a 40-hex infoHash or an
    // https url. A magnet: url is neither, and would be dropped in silence.
    const { plugin } = await load()
    const hash = 'e'.repeat(40)
    const { api } = makeApi(plugin.manifest.hosts, answers({
      [COMET]: body([{ name: 'Comet', title: 'x', url: `magnet:?xt=urn:btih:${hash.toUpperCase()}&dn=Movie` }]),
    }))

    const [stream] = plain(await plugin.streams(MOVIE, api))
    assert.equal(stream.infoHash, hash)
    assert.equal(stream.url, undefined, 'the magnet is gone, not left alongside')
  })

  it('leaves an https url alone', async () => {
    const { plugin } = await load()
    const direct = { name: 'Direct', title: 'x', url: 'https://example.com/movie.mkv' }
    const { api } = makeApi(plugin.manifest.hosts, answers({ [COMET]: body([direct]) }))

    const [stream] = plain(await plugin.streams(MOVIE, api))
    assert.equal(stream.url, direct.url, 'an https url is not a magnet to unpack')
    assert.equal(stream.infoHash, undefined)
  })

  it('dedupes a magnet against the same torrent seen as an infoHash', async () => {
    const { plugin } = await load()
    const hash = FROM_BRAZUCA.infoHash
    const { api } = makeApi(plugin.manifest.hosts, answers({
      [BRAZUCA]: body([FROM_BRAZUCA]),
      [COMET]: body([{ name: 'Comet', title: 'x', fileIdx: 0, url: `magnet:?xt=urn:btih:${hash}` }]),
    }))

    assert.equal(plain(await plugin.streams(MOVIE, api)).length, 1)
  })
})

describe('one provider going down', () => {
  it('does not take the other with it', async () => {
    const { plugin } = await load()
    const { api } = makeApi(plugin.manifest.hosts, (url) => (
      new URL(url).hostname === BRAZUCA
        ? { status: 502, body: 'Bad Gateway' }
        : body([FROM_TORRENTIO])
    ))

    assert.deepEqual(plain(await plugin.streams(MOVIE, api)), [FROM_TORRENTIO])
  })

  it('survives one that hangs, and still answers from the other', async () => {
    const { plugin } = await load({ timeScale: 200 })
    const { api } = makeApi(plugin.manifest.hosts, (url) => (
      new URL(url).hostname === BRAZUCA ? 'hang' : body([FROM_TORRENTIO])
    ))

    assert.deepEqual(plain(await plugin.streams(MOVIE, api)), [FROM_TORRENTIO])
  })

  it('answers empty rather than throwing when everything is down', async () => {
    const { plugin } = await load()
    const { api, calls } = makeApi(plugin.manifest.hosts, () => ({ status: 502, body: 'Bad Gateway' }))

    assert.deepEqual(plain(await plugin.streams(MOVIE, api)), [])
    assert.ok(calls.length <= MAX_REQUESTS, `${calls.length} requests is over the ceiling`)
  })

  it('never asks for a host the manifest does not declare', async () => {
    const { plugin } = await load()
    const { api, calls } = makeApi(plugin.manifest.hosts, () => ({ status: 502, body: '' }))
    await plugin.streams(MOVIE, api)

    for (const url of calls) {
      assert.equal(checkFetchUrl(url, plugin.manifest.hosts).ok, true, `policy would block ${url}`)
    }
  })
})

describe('mirrors, which are tried in order and not merged', () => {
  it('falls over to ElfHosted when the main instance refuses the request', async () => {
    const { plugin } = await load()
    const { api, calls } = makeApi(plugin.manifest.hosts, answers({
      [TORRENTIO]: { status: 403, body: 'Forbidden' },
      [ELFHOSTED]: body([FROM_TORRENTIO]),
    }))

    assert.deepEqual(plain(await plugin.streams(MOVIE, api)), [FROM_TORRENTIO])
    assert.ok(hostsOf(calls).includes(ELFHOSTED))
  })

  it('leaves the second mirror alone when the first answers', async () => {
    const { plugin } = await load()
    const { api, calls } = makeApi(plugin.manifest.hosts, answers({
      [TORRENTIO]: body([FROM_TORRENTIO]),
      [ELFHOSTED]: body([torrent('c')]),
    }))
    const streams = plain(await plugin.streams(MOVIE, api))

    assert.ok(!hostsOf(calls).includes(ELFHOSTED), 'a mirror answered is a mirror not asked')
    assert.equal(streams.length, 1)
  })

  it('retries without the configuration when the configured path is refused', async () => {
    const { plugin } = await load()
    const { api, calls } = makeApi(plugin.manifest.hosts, (url) => {
      const { hostname, pathname } = new URL(url)
      if (hostname !== TORRENTIO) return body([])
      return pathname === '/stream/movie/tt0111161.json' ? body([FROM_TORRENTIO]) : { status: 404, body: 'Not Found' }
    })
    const streams = plain(await plugin.streams(MOVIE, api))

    assert.deepEqual(streams, [FROM_TORRENTIO])
    const onTorrentio = calls.filter((url) => url.includes(TORRENTIO))
    assert.equal(onTorrentio.length, 2, 'the configured path, then the bare one')
    assert.equal(new URL(onTorrentio[1]).pathname, '/stream/movie/tt0111161.json')
  })

  it('treats an empty stream list as an answer, not as a failure to retry', async () => {
    const { plugin } = await load()
    const { api, calls } = makeApi(plugin.manifest.hosts, () => body([]))
    await plugin.streams(MOVIE, api)

    // `streams: []` means the upstream looked and found nothing, so no
    // bare-path retry anywhere: one request per mirror, and every mirror gets
    // its turn because no mirror had anything.
    assert.deepEqual(hostsOf(calls).sort(), [
      BRAZUCA, CINEMETA, COMET, COMET_MIRROR, ELFHOSTED, MEDIAFUSION, MICOLEAO, TORRENTIO,
    ].sort())
  })
})

describe('addons that describe a release in the newer field', () => {
  it('copies description into title, which is the only one the app reads', async () => {
    // parseStreams in web/src/catalog/streams.ts reads stream.title and never
    // stream.description. Comet and MediaFusion set only the latter, so their
    // rows arrive with no name, no size, no seeders and no language flags.
    const { plugin } = await load()
    const { api } = makeApi(plugin.manifest.hosts, answers({
      [COMET]: body([{
        name: 'Comet',
        description: 'Filme.2026.1080p.WEB-DL\n👤 12 💾 4.2 GB ⚙️ TorrentGalaxy\n🇧🇷',
        infoHash: 'c'.repeat(40),
      }]),
    }))

    const [stream] = plain(await plugin.streams(MOVIE, api))
    assert.match(stream.title, /1080p/)
    assert.match(stream.title, /👤 12/)
  })

  it('does not overwrite a title an addon already set', async () => {
    const { plugin } = await load()
    const both = { name: 'X', title: 'the real one', description: 'the other one', infoHash: 'c'.repeat(40) }
    const { api } = makeApi(plugin.manifest.hosts, answers({ [COMET]: body([both]) }))

    assert.match(plain(await plugin.streams(MOVIE, api))[0].title, /^the real one/)
    assert.doesNotMatch(plain(await plugin.streams(MOVIE, api))[0].title, /the other one/)
  })
})

describe('torrents nobody is seeding', () => {
  it('drops one that says so, because no peers means no bytes', async () => {
    // juntos.lol reads the bytes from the swarm. A dead torrent does not fail
    // as "no seeders" — it fails as a remux that dies on the first read.
    const { plugin } = await load()
    const { api } = makeApi(plugin.manifest.hosts, answers({
      [COMET]: body([
        { name: 'Comet', description: 'Dead.1080p\n👤 0 💾 4 GB', infoHash: 'c'.repeat(40) },
        { name: 'Comet', description: 'Alive.1080p\n👤 7 💾 4 GB', infoHash: 'd'.repeat(40) },
      ]),
    }))

    const streams = plain(await plugin.streams(MOVIE, api))
    assert.equal(streams.length, 1)
    assert.match(streams[0].title, /Alive/)
  })

  it('keeps one that never says, because silence is not a zero', async () => {
    const { plugin } = await load()
    const quiet = { name: 'Brazuca', title: 'No counts here', infoHash: 'a'.repeat(40) }
    const { api } = makeApi(plugin.manifest.hosts, answers({ [BRAZUCA]: body([quiet]) }))

    const streams = plain(await plugin.streams(MOVIE, api))
    assert.equal(streams.length, 1)
    assert.equal(streams[0].infoHash, quiet.infoHash)
  })
})

describe('a provider that only serves some types', () => {
  it('is not asked for an episode when it only does movies', async () => {
    // Mico-Leão Dublado's live manifest declares types: ["movie"]. Asking it
    // for a series is a request spent to be told nothing.
    const { plugin } = await load()
    const { api, calls } = makeApi(plugin.manifest.hosts, answers({}))
    await plugin.streams(EPISODE, api)

    assert.ok(!hostsOf(calls).includes(MICOLEAO), 'it should have been skipped')
    assert.ok(hostsOf(calls).includes(BRAZUCA), 'the ones without a limit still run')
  })

  it('is asked for a movie', async () => {
    const { plugin } = await load()
    const { api, calls } = makeApi(plugin.manifest.hosts, answers({}))
    await plugin.streams(MOVIE, api)

    assert.ok(hostsOf(calls).includes(MICOLEAO))
  })
})

describe('addons that put seeders and size beside the title', () => {
  it('folds them into the title, where the app looks', async () => {
    // Mico-Leão Dublado's stream model carries `seeders` and `size` as
    // top-level fields; parseStreamTitle only reads the 👤 and 💾 markers.
    const { plugin } = await load()
    const { api } = makeApi(plugin.manifest.hosts, answers({
      [MICOLEAO]: body([{
        title: 'Star Wars: Episode IX',
        infoHash: 'e'.repeat(40),
        seeders: 131,
        size: 27831388078,
      }]),
    }))

    const [stream] = plain(await plugin.streams(MOVIE, api))
    assert.match(stream.title, /Star Wars/, 'the release name survives')
    assert.match(stream.title, /👤 131/)
    assert.match(stream.title, /💾 25\.92 GB/)
  })

  it('leaves a title that already carries the markers alone', async () => {
    const { plugin } = await load()
    const already = { title: 'X\n👤 9 💾 2 GB', infoHash: 'e'.repeat(40), seeders: 1, size: 5 }
    const { api } = makeApi(plugin.manifest.hosts, answers({ [MICOLEAO]: body([already]) }))

    const { title } = plain(await plugin.streams(MOVIE, api))[0]
    assert.match(title, /👤 9 💾 2 GB/, 'the numbers it already had are the numbers kept')
    assert.doesNotMatch(title, /👤 1\b/)
  })

  it('lets the dead-torrent filter finally see a zero it could not read before', async () => {
    const { plugin } = await load()
    const { api } = makeApi(plugin.manifest.hosts, answers({
      [MICOLEAO]: body([{ title: 'Dead', infoHash: 'e'.repeat(40), seeders: 0, size: 100 }]),
    }))

    assert.deepEqual(plain(await plugin.streams(MOVIE, api)), [])
  })
})

describe('the indexer, which searches by text', () => {
  const RESULT = {
    title: 'Filme.Dublado.2026.1080p.WEB-DL',
    original_title: 'The Movie',
    info_hash: 'F'.repeat(40),
    magnet_link: 'magnet:?xt=urn:btih:' + 'f'.repeat(40),
    size: '4.2 GB',
    seed_count: 23,
    audio: ['Português', 'Inglês'],
  }

  it('turns the IMDb id into a title first, then searches with it', async () => {
    const { plugin } = await load()
    const { api, calls } = makeApi(plugin.manifest.hosts, answers({
      [CINEMETA]: named('Um Novo Dia'),
      [INDEXER]: { status: 200, body: JSON.stringify({ results: [RESULT], count: 1 }) },
    }))
    const streams = plain(await plugin.streams(MOVIE, api))

    const lookup = calls.find((url) => url.includes(CINEMETA))
    assert.equal(new URL(lookup).pathname, '/meta/movie/tt0111161.json')

    const search = calls.filter((url) => url.includes(INDEXER))
    assert.equal(search.length, 6, 'one per indexer site')
    assert.equal(new URL(search[0]).searchParams.get('q'), 'Um Novo Dia')
    assert.ok(streams.some((s) => s.infoHash === 'f'.repeat(40)))
  })

  it('is skipped entirely when no title comes back', async () => {
    // Without a name there is nothing to search with, so spending the request
    // would only buy a 400.
    const { plugin } = await load()
    const { api, calls } = makeApi(plugin.manifest.hosts, answers({}))
    await plugin.streams(MOVIE, api)

    assert.ok(!hostsOf(calls).includes(INDEXER))
  })

  it('writes seeders, size and site where parseStreamTitle looks', async () => {
    const { plugin } = await load()
    const { api } = makeApi(plugin.manifest.hosts, answers({
      [CINEMETA]: named('Um Filme'),
      [INDEXER]: { status: 200, body: JSON.stringify({ results: [RESULT] }) },
    }))

    const [stream] = plain(await plugin.streams(MOVIE, api))
    assert.match(stream.title, /Filme\.Dublado/)
    assert.match(stream.title, /👤 23/)
    assert.match(stream.title, /💾 4\.2 GB/)
    assert.match(stream.title, /⚙️ (BluDV|Comando)/)
    assert.match(stream.title, /🇧🇷/, 'Português in the audio tags becomes a flag')
  })

  it('falls back to the magnet when the indexer has no info_hash', async () => {
    const { plugin } = await load()
    const { [`info_hash`]: _drop, ...noHash } = RESULT
    const { api } = makeApi(plugin.manifest.hosts, answers({
      [CINEMETA]: named('Um Filme'),
      [INDEXER]: { status: 200, body: JSON.stringify({ results: [noHash] }) },
    }))

    // normalize() pulls the hash out of the magnet on the way through.
    const [stream] = plain(await plugin.streams(MOVIE, api))
    assert.equal(stream.infoHash, 'f'.repeat(40))
  })

  it('drops a result carrying neither a hash nor a magnet', async () => {
    const { plugin } = await load()
    const { api } = makeApi(plugin.manifest.hosts, answers({
      [CINEMETA]: named('Um Filme'),
      [INDEXER]: { status: 200, body: JSON.stringify({ results: [{ title: 'nada' }] }) },
    }))

    assert.deepEqual(plain(await plugin.streams(MOVIE, api)), [])
  })
})

describe('saying which provider a row came from', () => {
  it('stamps the provider when the addon named no source', async () => {
    const { plugin } = await load()
    const { api } = makeApi(plugin.manifest.hosts, answers({
      [BRAZUCA]: body([{ title: 'DUBLADO DUAL ÁUDIO MKV 1080P', infoHash: 'a'.repeat(40) }]),
    }))

    const [stream] = plain(await plugin.streams(MOVIE, api))
    assert.match(stream.title, /⚙️ Brazuca Torrents/)
    // The marker only counts on the line parseStreamTitle picks as the stats
    // line, which it finds by 👤 or 💾.
    const statsLine = stream.title.split('\n').find((l) => l.includes('👤') || l.includes('💾'))
    assert.ok(statsLine?.includes('⚙️ Brazuca Torrents'), `no usable stats line in ${stream.title}`)
  })

  it('does not overwrite a source the addon gave itself', async () => {
    const { plugin } = await load()
    const { api } = makeApi(plugin.manifest.hosts, answers({
      [TORRENTIO]: body([{ title: 'X\n👤 5 💾 1 GB ⚙️ ThePirateBay', infoHash: 'b'.repeat(40) }]),
    }))

    const [stream] = plain(await plugin.streams(MOVIE, api))
    assert.match(stream.title, /⚙️ ThePirateBay/)
    assert.doesNotMatch(stream.title, /Torrentio/)
  })

  it('reads the size out of behaviorHints.videoSize', async () => {
    const { plugin } = await load()
    const { api } = makeApi(plugin.manifest.hosts, answers({
      [BRAZUCA]: body([{
        title: 'Um Filme',
        infoHash: 'a'.repeat(40),
        behaviorHints: { videoSize: 4509715660 },
      }]),
    }))

    assert.match(plain(await plugin.streams(MOVIE, api))[0].title, /💾 4\.20 GB/)
  })

  it('takes the numbers from a description even when a title exists', async () => {
    const { plugin } = await load()
    const { api } = makeApi(plugin.manifest.hosts, answers({
      [COMET]: body([{
        title: 'Release.1080p',
        description: 'Release.1080p\n👤 31 💾 3 GB',
        infoHash: 'c'.repeat(40),
      }]),
    }))

    const { title } = plain(await plugin.streams(MOVIE, api))[0]
    assert.match(title, /👤 31/)
    assert.match(title, /💾 3 GB/)
    assert.equal(title.split('\n').filter((l) => l.includes('Release.1080p')).length, 1,
      'the release name is not repeated into the label')
  })
})

describe('releases the worker cannot prepare', () => {
  const withTitle = (title) => ({ title, infoHash: 'a'.repeat(40) })

  it('drops TrueHD, which the worker has no matrix entry for', async () => {
    // ss-worker/ss-remux/src/plan.rs asserts this in its own test:
    // refuses_unlisted_codecs_clearly. One unlisted track kills the plan, so a
    // dual-audio release whose dub is AC-3 still fails on the original track.
    const { plugin } = await load()
    const { api } = makeApi(plugin.manifest.hosts, answers({
      [BRAZUCA]: body([withTitle('The.Movie.2160p.UHD.BluRay.TrueHD.7.1.Atmos-GRP')]),
    }))

    assert.deepEqual(plain(await plugin.streams(MOVIE, api)), [])
  })

  it('drops Atmos spelled on its own', async () => {
    const { plugin } = await load()
    const { api } = makeApi(plugin.manifest.hosts, answers({
      [BRAZUCA]: body([withTitle('The.Movie.2160p.ATMOS.DUAL-GRP')]),
    }))

    assert.deepEqual(plain(await plugin.streams(MOVIE, api)), [])
  })

  it('keeps DTS, which the matrix converts', async () => {
    const { plugin } = await load()
    const { api } = makeApi(plugin.manifest.hosts, answers({
      [BRAZUCA]: body([withTitle('The.Movie.1080p.BluRay.DTS-HD.MA.5.1-GRP')]),
    }))

    assert.equal(plain(await plugin.streams(MOVIE, api)).length, 1)
  })

  it('keeps an ordinary dual-audio release', async () => {
    const { plugin } = await load()
    const { api } = makeApi(plugin.manifest.hosts, answers({
      [BRAZUCA]: body([withTitle('The.Movie.2012.1080p.BluRay.x264.DUAL.AC3-GRP')]),
    }))

    assert.equal(plain(await plugin.streams(MOVIE, api)).length, 1)
  })
})

describe('deduplication', () => {
  it('keeps one row when both providers return the same torrent', async () => {
    const { plugin } = await load()
    const { api } = makeApi(plugin.manifest.hosts, answers({
      [BRAZUCA]: body([FROM_BRAZUCA]),
      [TORRENTIO]: body([{ ...FROM_BRAZUCA, title: 'a different spelling' }, FROM_TORRENTIO]),
    }))
    const streams = plain(await plugin.streams(MOVIE, api))

    assert.equal(streams.length, 2)
    assert.equal(streams[0].title, FROM_BRAZUCA.title, 'the first spelling wins')
  })

  it('does not collapse two files of the same torrent', async () => {
    const { plugin } = await load()
    const { api } = makeApi(plugin.manifest.hosts, answers({
      [BRAZUCA]: body([{ ...FROM_BRAZUCA, fileIdx: 0 }, { ...FROM_BRAZUCA, fileIdx: 3 }]),
    }))

    assert.equal(plain(await plugin.streams(MOVIE, api)).length, 2)
  })
})

describe('a target it cannot use', () => {
  const rejects = [
    ['no target', null],
    ['an unknown type', { type: 'channel', id: 'tt1' }],
    ['an id that would escape the path', { type: 'movie', id: '../../etc/passwd' }],
    ['a target with no id at all', { type: 'movie' }],
    ['an id that is not a string', { type: 'movie', id: 12345 }],
    ['an episode with no season', { type: 'series', id: 'tt1' }],
    ['an episode numbered with nonsense', { type: 'series', id: 'tt1', season: 1, episode: 'x' }],
  ]

  for (const [what, target] of rejects) {
    it(`refuses ${what} instead of asking anyway`, async () => {
      const { plugin } = await load()
      const { api, calls } = makeApi(plugin.manifest.hosts, () => body([FROM_BRAZUCA]))

      await assert.rejects(() => plugin.streams(target, api))
      assert.equal(calls.length, 0)
    })
  }
})
