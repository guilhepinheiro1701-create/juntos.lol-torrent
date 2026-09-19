import source from './builtin-source.js?raw'
import { buildInstall, type InstallDeps } from './install'
import { getPlugin, originId, putPlugin, type InstalledPlugin, type PluginOrigin } from './store'

/**
 * O plugin de fontes que vem junto com o site.
 *
 * Antes era preciso instalá-lo à mão, colando um endereço em Plugins. Isso
 * funcionava enquanto só existia um navegador; com o site aberto na TV, ou num
 * segundo computador da casa, o catálogo abria sem fonte nenhuma — a lista de
 * plugins mora no IndexedDB de cada navegador, e um navegador novo não tem
 * nada. Agora ele nasce instalado em qualquer um.
 *
 * Os hosts que ele declara já entram aprovados. É o mesmo nível de confiança
 * do resto da página: ele veio no mesmo download, assinado pelo mesmo git. Um
 * plugin que a pessoa traz de fora continua tendo de ser aprovado a dedo.
 *
 * Quem apagar não vê voltar: a lápide abaixo é o que impede o site de
 * reinstalá-lo no recarregamento seguinte.
 */
export const BUILTIN_NAME = 'juntos-br'

const BURIED_KEY = 'ss.builtin-plugin-removed'

export const builtinOrigin: PluginOrigin = { kind: 'builtin', name: BUILTIN_NAME, updateUrl: null }

export function builtinId(): Promise<string> {
  return originId(builtinOrigin)
}

export function builtinWasRemoved(): boolean {
  try {
    return localStorage.getItem(BURIED_KEY) === '1'
  } catch {
    return false
  }
}

/** Chamado quando a pessoa apaga o plugin que veio com o site. */
export function rememberBuiltinRemoved(): void {
  try {
    localStorage.setItem(BURIED_KEY, '1')
  } catch {}
}

/** Desfaz a lápide, para quem quiser o de fábrica de volta. */
export function forgetBuiltinRemoved(): void {
  try {
    localStorage.removeItem(BURIED_KEY)
  } catch {}
}

export interface BuiltinDeps extends InstallDeps {
  read?: (id: string) => Promise<InstalledPlugin | null>
  save?: (plugin: InstalledPlugin) => Promise<void>
}

/**
 * Instala o que veio com o site, ou o atualiza quando o site foi atualizado.
 *
 * Nunca mexe no que a pessoa escolheu: se ela desligou o plugin, ele continua
 * desligado; se apagou, não volta. O que muda numa atualização é só a fonte e
 * o manifesto.
 */
export async function ensureBuiltin(deps: BuiltinDeps = {}): Promise<'installed' | 'updated' | 'kept' | 'buried'> {
  const read = deps.read ?? getPlugin
  const save = deps.save ?? putPlugin

  if (builtinWasRemoved()) return 'buried'

  const fresh = await buildInstall(source, builtinOrigin, deps)
  const held = await read(fresh.id)
  if (!held) {
    await save(fresh)
    return 'installed'
  }
  if (held.sha256 === fresh.sha256) return 'kept'

  await save({
    ...fresh,
    // O que a pessoa decidiu sobrevive a uma atualizacao do site.
    enabled: held.enabled,
    installedAt: held.installedAt,
    // Hosts novos entram aprovados, como na primeira instalacao: continuam
    // sendo os do plugin que veio no mesmo download que esta pagina.
    approvedHosts: fresh.manifest.hosts,
    pendingUpdate: null,
  })
  return 'updated'
}
