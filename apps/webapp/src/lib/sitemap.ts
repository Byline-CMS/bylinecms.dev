/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Dynamic sitemap building blocks — the entry types, an aggregator over
 * per-collection getters, and the XML serializer. The route handler
 * (`src/routes/sitemap[.]xml.ts`) wires these together.
 *
 * Also home to the substrate shared by both agent-facing surfaces:
 * `PublishedEntry`, `PUBLISHED_TTL_MS` and `stringOrUndefined`. The
 * per-collection getters that produce those entries live in their own
 * modules (`@/modules/<x>/published`) so each collection owns its
 * enumeration; only the shape they agree on is centralised here.
 *
 * hreflang alternates are derived from the same `resolveAlternates` helper
 * that `getMeta` uses, so the sitemap and per-page meta advertise an
 * identical language set per document — one source of truth, no drift.
 *
 * One `<url>` per document: `<loc>` is the default-locale URL, and each
 * *advertised* language (plus `x-default`) becomes an `<xhtml:link
 * rel="alternate">`. Because the advertised set is the same regardless of
 * read locale and slugs aren't localized, each document yields exactly one
 * entry — no per-locale fan-out.
 */

import { i18nConfig } from '@/i18n/i18n-config'
import { resolveAlternates } from '@/lib/alternates'

export interface SitemapEntry {
  /** Path segments after the locale prefix, e.g. `['news', 'my-post']`. */
  segments: Array<string | null | undefined>
  /** W3C date (`YYYY-MM-DD`) for `<lastmod>`; omitted when unknown. */
  lastmod?: string
  /** The document's public advertised locale set (`availableLocales ∩
   * _availableVersionLocales`) → hreflang alternates. See `advertisedLocalesFor`. */
  advertisedLocales?: string[] | null
}

/**
 * One published document, in the shape both `sitemap.xml` and `llms.txt`
 * need: URL segments, `lastmod` + advertised locales (sitemap), title +
 * description (llms.txt). Produced by the per-collection getters in
 * `@/modules/<x>/published`.
 */
export interface PublishedEntry {
  /** Path segments after the locale prefix, e.g. `['news', 'my-post']`. */
  segments: string[]
  /** The document's display title (llms.txt link text). */
  title?: string
  /** Short description (llms.txt link notes). */
  description?: string
  /** Publication / update date for `<lastmod>`. */
  lastmod?: Date | string | null
  /** Advertised locale set (`availableLocales ∩ _availableVersionLocales`). */
  advertisedLocales?: string[] | null
}

/** Published-document scans change infrequently; cache for an hour. */
export const PUBLISHED_TTL_MS = 60 * 60 * 1000

/** Narrow an unknown field value to a non-blank string, or `undefined`. */
export function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

const XML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
}

function xmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (c) => XML_ESCAPE[c] ?? c)
}

/** Normalize a date-ish value to a W3C `YYYY-MM-DD` string, or `undefined`. */
export function toSitemapDate(value: string | Date | null | undefined): string | undefined {
  if (value == null) return undefined
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return date.toISOString().slice(0, 10)
}

/** Run each per-collection getter and flatten the results into one list. */
export async function getSitemapData(
  getters: Array<() => Promise<SitemapEntry[]>>
): Promise<SitemapEntry[]> {
  const groups = await Promise.all(getters.map((get) => get()))
  return groups.flat()
}

/** Serialize entries to a sitemap XML document (with xhtml hreflang links). */
export function generateSitemap(entries: SitemapEntry[], serverUrl: string): string {
  const body = entries
    .map((entry) => {
      // <loc> + alternates are resolved against the *default* locale: the
      // canonical sitemap URL is the unprefixed default-locale URL, and the
      // advertised languages hang off it as xhtml:link alternates.
      const { canonical, alternates, xDefaultPath } = resolveAlternates(
        entry.advertisedLocales,
        i18nConfig.defaultLocale,
        ...entry.segments
      )
      const loc = new URL(canonical, serverUrl).toString()

      const links =
        alternates.length > 0
          ? [
              ...alternates.map((a) => ({
                hreflang: a.hreflang,
                href: new URL(a.path, serverUrl).toString(),
              })),
              { hreflang: 'x-default', href: new URL(xDefaultPath, serverUrl).toString() },
            ]
          : []

      const lines = [`    <loc>${xmlEscape(loc)}</loc>`]
      if (entry.lastmod != null) lines.push(`    <lastmod>${entry.lastmod}</lastmod>`)
      for (const link of links) {
        lines.push(
          `    <xhtml:link rel="alternate" hreflang="${xmlEscape(link.hreflang)}" href="${xmlEscape(link.href)}" />`
        )
      }
      return `  <url>\n${lines.join('\n')}\n  </url>`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${body}\n</urlset>\n`
}

/**
 * Static, non-collection URLs (home + the section index pages). These are
 * interface-localized chrome rather than documents, so they carry no
 * advertised-locale set and emit a single default-locale `<loc>` — the
 * hreflang cluster is reserved for the content dimension.
 */
export async function getStaticSitemap(): Promise<SitemapEntry[]> {
  return [{ segments: [] }, { segments: ['news'] }, { segments: ['docs'] }]
}
