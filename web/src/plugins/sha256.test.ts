import { describe, expect, it } from 'vitest'
import { sha256, toHex } from './sha256'

const hex = (texto: string) => toHex(sha256(new TextEncoder().encode(texto)))

describe('sha256 em JavaScript', () => {
  // Vetores da própria especificação e casos clássicos.
  it('bate com os vetores conhecidos', () => {
    expect(hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
  })

  // A fronteira do bloco de 64 bytes e a do preenchimento de 9 sao onde um
  // sha256 escrito a mao costuma errar.
  it('acerta nas fronteiras de bloco', async () => {
    for (const n of [0, 1, 54, 55, 56, 63, 64, 65, 119, 120, 127, 128, 1000]) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 0xff)
      const nativo = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
      expect(toHex(sha256(bytes)), `com ${n} bytes`).toBe(toHex(nativo))
    }
  })

  // Um megabyte e mais do que qualquer plugin: o limite de fonte e 1 MiB.
  it('bate com o WebCrypto em entradas aleatórias, inclusive grandes', async () => {
    for (const n of [7, 333, 4096, 100_000, 1 << 20]) {
      const bytes = new Uint8Array(n)
      crypto.getRandomValues(bytes.subarray(0, Math.min(n, 65536)))
      for (let i = 65536; i < n; i++) bytes[i] = (i * 17) & 0xff
      const nativo = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
      expect(toHex(sha256(bytes)), `com ${n} bytes`).toBe(toHex(nativo))
    }
  })

  it('não confunde bytes altos com caracteres', async () => {
    const bytes = new TextEncoder().encode('Duna — ação, ficção, 2021 ✅')
    const nativo = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    expect(toHex(sha256(bytes))).toBe(toHex(nativo))
  })
})

// O caso real: a TV e o outro computador abrem o site por http://192.168.x.x,
// que nao e contexto seguro, e ali `crypto.subtle` simplesmente nao existe.
describe('sha256Hex sem WebCrypto', () => {
  it('da a mesma resposta com e sem ele', async () => {
    const { sha256Hex } = await import('./store')
    const fonte = 'export const manifest = { id: "p", hosts: ["a.test"] }'

    const comNativo = await sha256Hex(fonte)

    const real = globalThis.crypto
    try {
      // Um `crypto` sem `subtle`: e exatamente o que um navegador oferece numa
      // origem insegura, e nao um objeto ausente.
      Object.defineProperty(globalThis, 'crypto', {
        value: { getRandomValues: real.getRandomValues.bind(real) },
        configurable: true,
      })
      expect(globalThis.crypto.subtle).toBeUndefined()
      await expect(sha256Hex(fonte)).resolves.toBe(comNativo)
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: real, configurable: true })
    }
  })
})
