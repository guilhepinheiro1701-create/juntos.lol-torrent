/**
 * O plugin que vem com o site e JavaScript puro de proposito: ele e tambem o
 * arquivo que alguem instala a mao, e um .ts nao serviria para isso. Estas
 * assinaturas existem so para o tsc; o contrato de verdade e conferido em
 * builtinSource.test.ts, contra o mesmo parseManifest que julga um plugin
 * trazido de fora.
 */
export const manifest: unknown
export function streams(target: unknown, api: unknown): Promise<unknown>
