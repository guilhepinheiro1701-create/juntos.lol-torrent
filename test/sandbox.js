/**
 * A stand-in for the box juntos.lol runs a plugin inside, close enough that a
 * plugin which passes here is unlikely to surprise anyone there.
 *
 * Three things are reproduced, and they mirror, in order, `web/src/plugins/`
 * of giulianoo0/juntos.lol: `worker.ts` (the scope a plugin wakes up in),
 * `policy.ts` (which URLs `api.fetch` may reach) and `manifest.ts` (what a
 * manifest must look like). They are restated here rather than imported
 * because a plugin is a standalone repository with no dependency on the app —
 * which also means these copies can drift, so each one names its source.
 */

import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

/** web/src/plugins/worker.ts — every global a plugin is allowed to keep. */
export const ALLOWED = new Set([
  'self', 'globalThis', 'postMessage', 'onmessage', 'onmessageerror', 'close',
  'onerror', 'onunhandledrejection', 'onrejectionhandled',
  'addEventListener', 'removeEventListener', 'dispatchEvent', 'constructor',
  'EventTarget', 'Event', 'MessageEvent', 'ErrorEvent', 'PromiseRejectionEvent',
  'DOMException', 'WorkerGlobalScope', 'DedicatedWorkerGlobalScope',

  'Object', 'Function', 'Boolean', 'Symbol', 'Array', 'Number', 'BigInt',
  'String', 'RegExp', 'Date', 'Math', 'JSON', 'Promise', 'Proxy', 'Reflect',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'WeakRef', 'FinalizationRegistry',
  'ArrayBuffer', 'DataView', 'Int8Array', 'Uint8Array', 'Uint8ClampedArray',
  'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float16Array',
  'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
  'Error', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError',
  'TypeError', 'URIError', 'AggregateError', 'Intl', 'Iterator',
  'AsyncFunction', 'GeneratorFunction', 'AsyncGeneratorFunction',
  'DisposableStack', 'AsyncDisposableStack', 'SuppressedError',
  'undefined', 'NaN', 'Infinity', 'eval', 'isFinite', 'isNaN',
  'parseFloat', 'parseInt', 'decodeURI', 'decodeURIComponent',
  'encodeURI', 'encodeURIComponent', 'escape', 'unescape',

  'console', 'crypto', 'Crypto', 'SubtleCrypto', 'CryptoKey',
  'performance', 'Performance',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'queueMicrotask', 'structuredClone', 'reportError',
  'atob', 'btoa',
  'TextEncoder', 'TextDecoder', 'TextEncoderStream', 'TextDecoderStream',
  'URL', 'URLSearchParams',
  'AbortController', 'AbortSignal',
  'Blob', 'CompressionStream', 'DecompressionStream',
  'ReadableStream', 'ReadableStreamDefaultReader', 'ReadableStreamBYOBReader',
  'ReadableStreamDefaultController', 'ReadableByteStreamController',
  'ReadableStreamBYOBRequest', 'WritableStream', 'WritableStreamDefaultWriter',
  'WritableStreamDefaultController', 'TransformStream',
  'TransformStreamDefaultController', 'ByteLengthQueuingStrategy',
  'CountQueuingStrategy',
])

/**
 * A worker has these and a bare vm context does not, so they are seeded before
 * the trim rather than after: the point of the trim is to take things away,
 * and it cannot take away what was never there.
 */
const WORKER_EXTRAS = {
  console, crypto, performance,
  setTimeout, clearTimeout, setInterval, clearInterval,
  queueMicrotask, structuredClone, atob, btoa,
  TextEncoder, TextDecoder, TextEncoderStream, TextDecoderStream,
  URL, URLSearchParams, AbortController, AbortSignal, Blob,
  CompressionStream, DecompressionStream,
  ReadableStream, WritableStream, TransformStream,
  ByteLengthQueuingStrategy, CountQueuingStrategy,
}

/** The trim itself, walking the prototype chain exactly as worker.ts does. */
const TRIM = `
// Wrapped, and with the list captured first: the loop is about to delete the
// very property it is reading the list from, and it leaves no binding behind
// for the plugin to find afterwards.
(() => {
  const allowed = globalThis.ALLOWED
  delete globalThis.ALLOWED
  for (let scope = globalThis; scope && scope !== Object.prototype; scope = Object.getPrototypeOf(scope)) {
    for (const name of Object.getOwnPropertyNames(scope)) {
      if (allowed.has(name)) continue
      try { delete scope[name] } catch {}
      try { Object.defineProperty(scope, name, { value: undefined, writable: false, configurable: false }) } catch {}
    }
  }
})()
`

/**
 * Values cross a realm boundary keeping the *other* realm's prototypes, so an
 * array out of the box is not `Array` out here and a strict deep-equal against
 * a literal fails on identity while reporting identical contents. Everything
 * the box hands back goes through this first.
 */
export const plain = (value) => structuredClone(value)

/** Names still reachable after the trim. Anything outside ALLOWED is a leak. */
export function survivingGlobals(context) {
  return plain(vm.runInContext(
    'Object.getOwnPropertyNames(globalThis).filter((n) => globalThis[n] !== undefined)',
    context,
  ))
}

/**
 * Loads a plugin the way the app does: as a module, evaluated inside the
 * trimmed scope, never in the surrounding realm.
 */
export async function loadPlugin(path, options = {}) {
  const source = await readFile(path, 'utf8')
  // `timeScale` shortens the plugin's own waits so that a test for "this
  // upstream hung" costs milliseconds instead of the seconds the plugin is
  // right to wait in production. Nothing else about the clock moves.
  const scale = options.timeScale ?? 1
  const extras = scale === 1 ? WORKER_EXTRAS : {
    ...WORKER_EXTRAS,
    setTimeout: (fn, ms, ...rest) => setTimeout(fn, ms / scale, ...rest),
    setInterval: (fn, ms, ...rest) => setInterval(fn, ms / scale, ...rest),
  }
  const context = vm.createContext({ ...extras, ALLOWED })
  vm.runInContext(TRIM, context)

  const module = new vm.SourceTextModule(source, { context, identifier: 'plugin.js' })
  await module.link(() => { throw new Error('a plugin may not import anything') })
  await module.evaluate()
  return { namespace: module.namespace, context, source }
}

/** web/src/plugins/policy.ts — applied to the request and to where it landed. */
export function checkFetchUrl(raw, hosts, selfOrigin = 'https://juntos.lol') {
  let url
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'scheme' }
  const host = url.hostname.toLowerCase().replace(/\.+$/, '')
  if (host === new URL(selfOrigin).hostname.toLowerCase()) return { ok: false, reason: 'self-origin' }
  if (host === 'localhost' || host.endsWith('.localhost') || host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return { ok: false, reason: 'private-host' }
  }
  if (!hosts.includes(host)) return { ok: false, reason: 'host-not-declared' }
  return { ok: true, url }
}

export const MAX_REQUESTS = 32
export const RUN_TIMEOUT_MS = 15_000

/**
 * The page's side of `api.fetch`: the policy, the request ceiling, and a
 * routing table the test controls. `routes` maps a URL to a reply, to a
 * function of the URL, or to a delay that never answers.
 */
export function makeApi(hosts, routes, options = {}) {
  const calls = []
  const selfOrigin = options.selfOrigin ?? 'https://juntos.lol'
  const api = {
    async fetch(raw) {
      calls.push(raw)
      if (calls.length > MAX_REQUESTS) throw new Error(`plugin exceeded ${MAX_REQUESTS} requests`)
      const decision = checkFetchUrl(raw, hosts, selfOrigin)
      if (!decision.ok) return reply(false, 0, `blocked: ${decision.reason}`)

      const route = typeof routes === 'function' ? routes(raw) : routes[raw]
      if (route === undefined) return reply(false, 404, 'not found')
      const resolved = typeof route === 'function' ? await route(raw) : route
      if (resolved === 'hang') return new Promise(() => {})
      const { status = 200, body = '' } = resolved
      return reply(status >= 200 && status < 300, status, typeof body === 'string' ? body : JSON.stringify(body))
    },
  }
  return { api, calls }
}

function reply(ok, status, text) {
  return { ok, status, text: async () => text, json: async () => JSON.parse(text) }
}

/** web/src/plugins/manifest.ts, reduced to what it accepts and rejects. */
export function assertManifest(manifest) {
  const problems = []
  const str = (value, field, max) => {
    if (typeof value !== 'string') return problems.push(`${field} must be a string`)
    const trimmed = value.trim()
    if (trimmed === '' || trimmed.length > max || /\p{C}/u.test(trimmed)) problems.push(`${field} is invalid`)
  }
  if (typeof manifest !== 'object' || manifest === null) return ['manifest is not an object']

  str(manifest.id, 'id', 64)
  if (typeof manifest.id === 'string' && !/^[a-z0-9-]{1,64}$/.test(manifest.id)) problems.push('id must match [a-z0-9-]')
  str(manifest.name, 'name', 64)
  str(manifest.version, 'version', 32)

  if (!Array.isArray(manifest.hosts) || manifest.hosts.length === 0) {
    problems.push('hosts must be a non-empty list')
  } else if (manifest.hosts.length > 16) {
    problems.push('hosts must have at most 16 entries')
  } else {
    for (const host of manifest.hosts) {
      if (typeof host !== 'string' || host.length > 253) { problems.push(`host ${String(host)} is invalid`); continue }
      const lower = host.toLowerCase()
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(lower)) {
        problems.push(`host ${host} must be a bare hostname`)
      } else if (lower.split('.').some((label) => label.length > 63)) {
        problems.push(`host ${host} has an overlong label`)
      } else if (/^\d+$/.test(lower.slice(lower.lastIndexOf('.') + 1))) {
        problems.push(`host ${host} must be a name, not an address`)
      } else if (new URL(`https://${lower}`).hostname !== lower) {
        problems.push(`host ${host} is not in its canonical spelling`)
      }
    }
  }

  if (manifest.updateUrl !== undefined && manifest.updateUrl !== null) {
    str(manifest.updateUrl, 'updateUrl', 512)
    let url = null
    try { url = new URL(manifest.updateUrl) } catch { problems.push('updateUrl is not a URL') }
    if (url) {
      if (url.protocol !== 'https:') problems.push('updateUrl must be https')
      if (url.username || url.password) problems.push('updateUrl must not carry credentials')
    }
  }
  return problems
}

/** web/src/plugins/install.ts — only a GitHub repository is installable by URL. */
export function canonicalRepoUrl(repoUrl) {
  const url = new URL(repoUrl)
  if (url.protocol !== 'https:') throw new Error('must be https')
  if (url.hostname.toLowerCase().replace(/\.+$/, '') !== 'github.com') throw new Error('only github repositories')
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length < 2) throw new Error('not a repository path')
  const owner = parts[0].toLowerCase()
  const repo = parts[1].replace(/\.git$/i, '').toLowerCase()
  for (const part of [owner, repo]) {
    if (part === '' || /^\.+$/.test(part) || !/^[a-z0-9._-]+$/.test(part)) throw new Error('not a repository path')
  }
  return `https://github.com/${owner}/${repo}`
}
