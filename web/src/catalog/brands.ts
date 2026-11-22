import { searchByType, type CatalogMeta, type MetaType } from './tmdb'
// Logotipos guardados no proprio site (nada e buscado fora para desenhar os
// tiles). Origem: Wikimedia Commons; o da DC, do simple-icons. Conferidos:
// sem script e sem referencia externa dentro dos SVGs.
import marvelLogo from '../assets/brands/marvel.svg'
import disneyLogo from '../assets/brands/disney.svg'
import pixarLogo from '../assets/brands/pixar.svg'
import starwarsLogo from '../assets/brands/starwars.svg'
import dcLogo from '../assets/brands/dc.svg'
import wizardingLogo from '../assets/brands/wizarding.svg'

/**
 * As colecoes por produtora (Marvel, Disney, Pixar...).
 *
 * O catalogo de metadados nao filtra por estudio, entao cada colecao e uma
 * lista escolhida a mao de titulo + ano. Cada titulo e achado pela busca
 * normal e so entra se o ano bater — assim um nome parecido de outro filme
 * nunca aparece no lugar errado; na duvida, o titulo simplesmente fica de fora.
 */
export type BrandKey = 'marvel' | 'disney' | 'pixar' | 'starwars' | 'dc' | 'wizarding'

interface BrandTitle { title: string; year: string; type?: MetaType }

export interface Brand {
  key: BrandKey
  name: string
  /** Duas cores da marca: o fundo do tile e o brilho que ele emite. */
  colors: [string, string]
  /** Logotipos, tentados em ordem; se nenhum abrir, o tile mostra o nome. */
  logos: string[]
  /** Pinta o logotipo de branco (os que vem coloridos sobre fundo claro). */
  mono?: boolean
  titles: BrandTitle[]
}

export const BRANDS: Brand[] = [
  {
    key: 'marvel', name: 'Marvel', colors: ['#E62429', '#7A0A10'],
    logos: [marvelLogo],
    titles: [
      { title: 'Avengers: Endgame', year: '2019' }, { title: 'Avengers: Infinity War', year: '2018' },
      { title: 'Spider-Man: No Way Home', year: '2021' }, { title: 'Iron Man', year: '2008' },
      { title: 'The Avengers', year: '2012' }, { title: 'Guardians of the Galaxy', year: '2014' },
      { title: 'Black Panther', year: '2018' }, { title: 'Thor: Ragnarok', year: '2017' },
      { title: 'Captain America: The Winter Soldier', year: '2014' }, { title: 'Captain America: Civil War', year: '2016' },
      { title: 'Doctor Strange', year: '2016' }, { title: 'Deadpool & Wolverine', year: '2024' },
      { title: 'Ant-Man', year: '2015' }, { title: 'Captain Marvel', year: '2019' },
      { title: 'Loki', year: '2021', type: 'series' }, { title: 'WandaVision', year: '2021', type: 'series' },
    ],
  },
  {
    key: 'disney', name: 'Disney', colors: ['#1E4BD2', '#0B1A5C'],
    logos: [disneyLogo], mono: true,
    titles: [
      { title: 'Frozen', year: '2013' }, { title: 'Moana', year: '2016' }, { title: 'The Lion King', year: '1994' },
      { title: 'Encanto', year: '2021' }, { title: 'Zootopia', year: '2016' }, { title: 'Tangled', year: '2010' },
      { title: 'Big Hero 6', year: '2014' }, { title: 'Aladdin', year: '1992' },
      { title: 'Beauty and the Beast', year: '1991' }, { title: 'The Little Mermaid', year: '1989' },
      { title: 'Frozen II', year: '2019' }, { title: 'Wreck-It Ralph', year: '2012' },
      { title: 'Lilo & Stitch', year: '2002' }, { title: 'Mulan', year: '1998' },
    ],
  },
  {
    key: 'pixar', name: 'Pixar', colors: ['#2FA8E0', '#0C3A5A'],
    logos: [pixarLogo], mono: true,
    titles: [
      { title: 'Toy Story', year: '1995' }, { title: 'Finding Nemo', year: '2003' }, { title: 'Up', year: '2009' },
      { title: 'WALL·E', year: '2008' }, { title: 'Inside Out', year: '2015' }, { title: 'Coco', year: '2017' },
      { title: 'Ratatouille', year: '2007' }, { title: 'The Incredibles', year: '2004' },
      { title: 'Monsters, Inc.', year: '2001' }, { title: 'Cars', year: '2006' },
      { title: 'Toy Story 3', year: '2010' }, { title: 'Soul', year: '2020' },
      { title: 'Inside Out 2', year: '2024' }, { title: 'Luca', year: '2021' },
    ],
  },
  {
    key: 'starwars', name: 'Star Wars', colors: ['#E8C547', '#2A2410'],
    logos: [starwarsLogo],
    titles: [
      { title: 'Star Wars', year: '1977' }, { title: 'The Empire Strikes Back', year: '1980' },
      { title: 'Return of the Jedi', year: '1983' }, { title: 'Star Wars: Episode I - The Phantom Menace', year: '1999' },
      { title: 'Star Wars: Episode II - Attack of the Clones', year: '2002' },
      { title: 'Star Wars: Episode III - Revenge of the Sith', year: '2005' },
      { title: 'Star Wars: The Force Awakens', year: '2015' }, { title: 'Star Wars: The Last Jedi', year: '2017' },
      { title: 'Star Wars: The Rise of Skywalker', year: '2019' }, { title: 'Rogue One: A Star Wars Story', year: '2016' },
      { title: 'The Mandalorian', year: '2019', type: 'series' }, { title: 'Andor', year: '2022', type: 'series' },
    ],
  },
  {
    key: 'dc', name: 'DC', colors: ['#0476F2', '#06204A'],
    logos: [dcLogo], mono: true,
    titles: [
      { title: 'The Dark Knight', year: '2008' }, { title: 'Batman Begins', year: '2005' },
      { title: 'The Dark Knight Rises', year: '2012' }, { title: 'The Batman', year: '2022' },
      { title: 'Joker', year: '2019' }, { title: 'Wonder Woman', year: '2017' }, { title: 'Man of Steel', year: '2013' },
      { title: 'Aquaman', year: '2018' }, { title: 'Shazam!', year: '2019' }, { title: 'The Suicide Squad', year: '2021' },
      { title: 'Superman', year: '2025' }, { title: 'The Penguin', year: '2024', type: 'series' },
    ],
  },
  {
    key: 'wizarding', name: 'Harry Potter', colors: ['#B8892B', '#2B1C08'],
    logos: [wizardingLogo], mono: true,
    titles: [
      { title: "Harry Potter and the Philosopher's Stone", year: '2001' },
      { title: 'Harry Potter and the Chamber of Secrets', year: '2002' },
      { title: 'Harry Potter and the Prisoner of Azkaban', year: '2004' },
      { title: 'Harry Potter and the Goblet of Fire', year: '2005' },
      { title: 'Harry Potter and the Order of the Phoenix', year: '2007' },
      { title: 'Harry Potter and the Half-Blood Prince', year: '2009' },
      { title: 'Harry Potter and the Deathly Hallows: Part 1', year: '2010' },
      { title: 'Harry Potter and the Deathly Hallows: Part 2', year: '2011' },
      { title: 'Fantastic Beasts and Where to Find Them', year: '2016' },
    ],
  },
]

/** Escolhe, entre os resultados da busca, o que e de fato aquele titulo. */
export function matchTitle(results: CatalogMeta[], year: string): CatalogMeta | null {
  return results.find((meta) => meta.releaseInfo.trim().startsWith(year)) ?? null
}

const loaded = new Map<BrandKey, Promise<CatalogMeta[]>>()

export function fetchBrand(brand: Brand): Promise<CatalogMeta[]> {
  let pending = loaded.get(brand.key)
  if (!pending) {
    pending = Promise.all(brand.titles.map(async ({ title, year, type = 'movie' }) => {
      try {
        return matchTitle(await searchByType(type, title), year)
      } catch {
        return null
      }
    })).then((found) => {
      const seen = new Set<string>()
      const metas = found.filter((meta): meta is CatalogMeta => {
        if (!meta || seen.has(`${meta.type}:${meta.id}`)) return false
        seen.add(`${meta.type}:${meta.id}`)
        return true
      })
      if (metas.length === 0) throw new Error('brand: nothing found')
      return metas
    })
    loaded.set(brand.key, pending)
    pending.catch(() => loaded.delete(brand.key))
  }
  return pending
}
