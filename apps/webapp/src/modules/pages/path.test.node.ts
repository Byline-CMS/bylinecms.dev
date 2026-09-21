import { describe, expect, it } from 'vitest'

import { buildPagePath, type PageArea } from '~/collections/pages/path'

import { resolveAlternates } from '@/lib/alternates'
import { pageAreaRedirect } from './path'

const areas: PageArea[] = ['root', 'about', 'legal']
const paths = { root: '/example', about: '/about/example', legal: '/legal/example' }

describe('page area URLs', () => {
  for (const area of areas) {
    const doc = { path: 'example', fields: { area } }
    it(`uses the ${area} area for links and every metadata locale`, () => {
      expect(buildPagePath(doc)).toBe(paths[area])
      expect(
        resolveAlternates(
          {
            sourceLocale: 'en',
            pathLocale: 'es',
            advertisedLocales: ['en', 'es'],
          },
          buildPagePath(doc)
        )
      ).toEqual({
        canonical: `/es${paths[area]}`,
        alternates: [
          { hreflang: 'en', path: paths[area] },
          { hreflang: 'es', path: `/es${paths[area]}` },
        ],
        xDefaultPath: paths[area],
      })
      // URL normalization keeps Spanish UI; editorial canonical may still be English.
      expect(
        resolveAlternates({ sourceLocale: 'en', pathLocale: 'es' }, buildPagePath(doc)).canonical
      ).toBe(paths[area])
    })
    for (const requested of areas) {
      it(`${requested} request for ${area} document redirects only when needed`, () => {
        expect(pageAreaRedirect(doc, requested, 'es')).toBe(
          requested === area ? null : `/es${paths[area]}`
        )
        expect(pageAreaRedirect(doc, requested, 'en')).toBe(requested === area ? null : paths[area])
      })
    }
  }
  it('defaults legacy documents with missing area to root', () => {
    expect(buildPagePath({ path: 'example', fields: {} })).toBe('/example')
    expect(pageAreaRedirect({ path: 'example' }, 'about', 'fr')).toBe('/fr/example')
  })
  it('does not invent a URL for a document without a slug', () => {
    expect(buildPagePath({ fields: { area: 'about' } })).toBeNull()
    expect(pageAreaRedirect({ path: '' }, 'legal', 'es')).toBeNull()
  })
})
