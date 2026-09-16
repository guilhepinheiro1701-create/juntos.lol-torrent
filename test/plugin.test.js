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
  it('asks both providers and hands every stream back', async () => {
    const { plugin } = await load()
    const { api, calls } = makeApi(plugin.manifest.hosts, answers({
      [BRAZUCA]: body([FROM_BRAZUCA]),
      [TORRENTIO]: body([FROM_TORRENTIO]),
    }))
    const streams = plain(await plugin.streams(MOVIE, api))

    assert.deepEqual(streams, [FROM_BRAZUCA, FROM_TORRENTIO])
    // One request each, and no reason to have touched the Torrentio mirror.
    assert.deepEqual(hostsOf(calls).sort(), [BRAZUCA, TORRENTIO].sort())
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

    assert.ok(calls.length > 0)
    for (const url of calls) {
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

  it('returns only streams the app can turn into a source', async () => {
    const { plugin } = await load()
    const { api } = makeApi(plugin.manifest.hosts, answers({
      [BRAZUCA]: body([FROM_BRAZUCA, { name: 'Direct', url: 'https://example.com/movie.mkv' }]),
    }))
    // readLocation in web/src/catalog/streams.ts drops anything that is neither.
    for (const stream of plain(await plugin.streams(MOVIE, api))) {
      const isTorrent = typeof stream.infoHash === 'string' && /^[0-9a-f]{40}$/i.test(stream.infoHash)
      const isDirect = typeof stream.url === 'string' && new URL(stream.url).protocol === 'https:'
      assert.ok(isTorrent || isDirect, `unusable stream: ${JSON.stringify(stream)}`)
    }
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
    // bare-path retry anywhere: one request for Brazuca, then Torrentio's two
    // mirrors in turn because neither had anything.
    assert.deepEqual(hostsOf(calls).sort(), [BRAZUCA, ELFHOSTED, TORRENTIO].sort())
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
