/** Shared, client-safe URL rule for page routes, metadata, navigation and schema hooks. */
export interface PagePathDocument {
  path?: string | null
  fields?: { area?: unknown }
}

export type PageArea = 'root' | 'about' | 'legal'

/** Missing area is the legacy root default; missing slug means no link yet. */
export function buildPagePath(doc: PagePathDocument): string | null {
  if (!doc.path) return null
  const area = doc.fields?.area
  return typeof area === 'string' && area !== 'root' ? `/${area}/${doc.path}` : `/${doc.path}`
}
