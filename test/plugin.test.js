import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import {
  ALLOWED, MAX_REQUESTS, RUN_TIMEOUT_MS,
  assertManifest, canonicalRepoUrl, checkFetchUrl, loadPlugin, makeApi, plain, survivingGlobals,
} from './sandbox.js'

const PLUGIN = fileURLToPath(new URL('../plugin.js', import.meta.url))

const MOVIE = { type: 'movie', id: 'tt0111161' }
const EPISODE = { type: 'series', id: 'tt0903747', season: 5, episode: 14 }

const TORRENT = {
  name: 'Torrentio\n1080p',
  title: 'The.Shawshank.Redemption.1994.1080p.BluRay\n👤 842 💾 2.1 GB ⚙️ ThePirateBay\n🇧🇷 / 🇺🇸',
  infoHash: 'a'.repeat(40),
  fileIdx: 0,
  behaviorHints: { filename: 'shawshank.1080p.mkv' },
}

const body = (streams) => ({ status: 200, body: JSON.stringify({ streams }) })

/** Answers any path under a host, so a test does not restate the URL grammar. */
const onHost = (host, reply) => (url) => (new URL(url).hostname === host ? reply : undefined)

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
    assert.ok(attempt < run, 'one attempt must not be able to spend the whole run')
  })
})

describe('resolving a title', () => {
  it('asks Torrentio for a movie and hands the streams back', async () => {
    const { plugin } = await load()
    const { api, calls } = makeApi(plugin.manifest.hosts, onHost('torrentio.strem.fun', body([TORRENT])))
    const streams = plain(await plugin.streams(MOVIE, api))

    assert.deepEqual(streams, [TORRENT])
    assert.equal(calls.length, 1)
    assert.ok(calls[0].startsWith('https://torrentio.strem.fun/'))
    assert.ok(calls[0].endsWith('/stream/movie/tt0111161.json'))
  })

  it('addresses an episode as id:season:episode', async () => {
    const { plugin } = await load()
    const { api, calls } = makeApi(plugin.manifest.hosts, onHost('torrentio.strem.fun', body([TORRENT])))
    await plugin.streams(EPISODE, api)

    assert.ok(calls[0].endsWith('/stream/series/tt0903747:5:14.json'), calls[0])
  })

  it('sends Torrentio its configuration', async () => {
    const { plugin } = await load()
    const { api, calls } = makeApi(plugin.manifest.hosts, onHost('torrentio.strem.fun', body([TORRENT])))
    await plugin.streams(MOVIE, api)

    const config = new URL(calls[0]).pathname.split('/')[1]
    assert.match(config, /providers=/)
    assert.match(config, /bludv/, 'the Brazilian trackers are the reason the config exists')
    assert.match(config, /language=portuguese/)
  })

  it('returns only streams the app can turn into a source', async () => {
    const { plugin } = await load()
    const { api } = makeApi(plugin.manifest.hosts, onHost('torrentio.strem.fun', body([
      TORRENT,
      { name: 'Direct', title: 'file', url: 'https://example.com/movie.mkv' },
    ])))
    // readLocation in web/src/catalog/streams.ts drops anything that is neither.
    for (const stream of plain(await plugin.streams(MOVIE, api))) {
      const torrent = typeof stream.infoHash === 'string' && /^[0-9a-f]{40}$/i.test(stream.infoHash)
      const direct = typeof stream.url === 'string' && new URL(stream.url).protocol === 'https:'
      assert.ok(torrent || direct, `unusable stream: ${JSON.stringify(stream)}`)
    }
  })
})

describe('when an upstream misbehaves', () => {
  it('retries without the configuration when the configured path is refused', async () => {
    const { plugin } = await load()
    const { api, calls } = makeApi(plugin.manifest.hosts, (url) => {
      if (new URL(url).hostname !== 'torrentio.strem.fun') return undefined
      return url.endsWith('/stream/movie/tt0111161.json') && new URL(url).pathname.split('/').length === 4
        ? body([TORRENT])
        : { status: 404, body: 'Not Found' }
    })
    const streams = plain(await plugin.streams(MOVIE, api))

    assert.deepEqual(streams, [TORRENT])
    assert.equal(calls.length, 2, 'the configured path, then the bare one')
    assert.equal(new URL(calls[1]).pathname, '/stream/movie/tt0111161.json')
  })

  it('treats an empty stream list as an answer, not as a failure to retry', async () => {
    const { plugin } = await load()
    const { api, calls } = makeApi(plugin.manifest.hosts, () => body([]))
    await plugin.streams(MOVIE, api)

    // One request per source, and no bare-path retry on either: `streams: []`
    // means the upstream looked and found nothing.
    assert.equal(calls.length, 2)
    assert.deepEqual(calls.map((url) => new URL(url).hostname), [
      'torrentio.strem.fun', 'torrentio.elfhosted.com',
    ])
  })

  it('falls over to the mirror when the main instance refuses the request', async () => {
    const { plugin } = await load()
    const { api, calls } = makeApi(plugin.manifest.hosts, (url) => (
      new URL(url).hostname === 'torrentio.elfhosted.com'
        ? body([TORRENT])
        : { status: 403, body: 'Forbidden' }
    ))
    const streams = plain(await plugin.streams(MOVIE, api))

    assert.deepEqual(streams, [TORRENT])
    assert.ok(calls.some((url) => url.includes('elfhosted')))
  })

  it('gives up on one that hangs and still answers from the next', async () => {
    const { plugin } = await load({ timeScale: 200 })
    const { api } = makeApi(plugin.manifest.hosts, (url) => (
      new URL(url).hostname === 'torrentio.strem.fun' ? 'hang' : body([TORRENT])
    ))
    const streams = plain(await plugin.streams(MOVIE, api))

    assert.deepEqual(streams, [TORRENT])
  })

  it('answers empty rather than throwing when every upstream is down', async () => {
    const { plugin } = await load()
    const { api, calls } = makeApi(plugin.manifest.hosts, () => ({ status: 502, body: 'Bad Gateway' }))

    assert.deepEqual(plain(await plugin.streams(MOVIE, api)), [])
    assert.ok(calls.length <= MAX_REQUESTS)
  })

  it('never asks for a host the manifest does not declare', async () => {
    const { plugin } = await load()
    const { api, calls } = makeApi(plugin.manifest.hosts, () => ({ status: 502, body: '' }))
    await plugin.streams(MOVIE, api)

    for (const url of calls) {
      assert.deepEqual(checkFetchUrl(url, plugin.manifest.hosts).ok, true, `policy would block ${url}`)
    }
  })
})

describe('deduplication', () => {
  it('keeps one row per torrent', async () => {
    const { plugin } = await load()
    const other = { ...TORRENT, infoHash: 'b'.repeat(40) }
    const { api } = makeApi(plugin.manifest.hosts, onHost('torrentio.strem.fun', body([
      TORRENT, { ...TORRENT, title: 'a different spelling' }, other,
    ])))

    const streams = plain(await plugin.streams(MOVIE, api))
    assert.equal(streams.length, 2)
    assert.equal(streams[0].title, TORRENT.title, 'the first spelling wins')
  })

  it('does not collapse two files of the same torrent', async () => {
    const { plugin } = await load()
    const { api } = makeApi(plugin.manifest.hosts, onHost('torrentio.strem.fun', body([
      { ...TORRENT, fileIdx: 0 }, { ...TORRENT, fileIdx: 3 },
    ])))

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
      const { api, calls } = makeApi(plugin.manifest.hosts, () => body([TORRENT]))

      await assert.rejects(() => plugin.streams(target, api))
      assert.equal(calls.length, 0)
    })
  }
})
