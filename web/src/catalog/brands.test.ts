import { describe, expect, it } from 'vitest'
import { BRANDS, matchTitle } from './brands'
import type { CatalogMeta } from './tmdb'

const meta = (id: string, year: string): CatalogMeta => ({ id, type: 'movie', name: id, poster: '', releaseInfo: year })

describe('brands', () => {
  it('only takes the result whose year matches', () => {
    expect(matchTitle([meta('remake', '2019'), meta('original', '1994')], '1994')?.id).toBe('original')
    expect(matchTitle([meta('other', '2001')], '1994')).toBeNull()
  })

  it('has unique keys and titles in every collection', () => {
    expect(new Set(BRANDS.map((brand) => brand.key)).size).toBe(BRANDS.length)
    for (const brand of BRANDS) expect(brand.titles.length).toBeGreaterThan(5)
  })
})
