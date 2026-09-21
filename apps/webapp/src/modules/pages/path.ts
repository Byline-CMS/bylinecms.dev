import { buildPagePath, type PageArea, type PagePathDocument } from '~/collections/pages/path'

import { buildLocalizedPath } from '@/lib/meta'

/** Normalize only the area, retaining the visitor's requested content locale. */
export function pageAreaRedirect(
  doc: PagePathDocument,
  requestedArea: PageArea,
  lng: string
): string | null {
  const actual = buildPagePath(doc)
  const requested = buildPagePath({ path: doc.path, fields: { area: requestedArea } })
  return actual != null && actual !== requested ? buildLocalizedPath(lng, actual) : null
}
