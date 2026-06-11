/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * `llms.txt` building blocks (https://llmstxt.org): an H1 site name, a
 * blockquote summary, then H2 sections of `- [title](url): notes` links.
 * Links point at each document's **markdown** representation (canonical
 * URL + `.md`) so an agent following them lands on the agent-readable
 * surface, not the HTML page.
 *
 * Sections are built from the same per-collection published-URL
 * enumeration the sitemap uses (`@/lib/published-index`) — one scan, one
 * cache entry, no drift between the two surfaces. Like the sitemap, the
 * index is locale-agnostic: links are default-locale canonical URLs and
 * the per-locale variants advertise themselves via the documents' own
 * hreflang alternates.
 */

import type { PublishedIndexEntry } from '@/lib/published-index'

export interface LlmsSection {
  /** H2 section heading, e.g. `Documentation`. */
  title: string
  entries: PublishedIndexEntry[]
}

export function generateLlmsTxt(
  sections: LlmsSection[],
  site: { name: string; description?: string; serverUrl: string }
): string {
  const lines: string[] = [`# ${site.name}`]
  if (site.description) {
    lines.push('', `> ${site.description}`)
  }
  for (const section of sections) {
    if (section.entries.length === 0) continue
    lines.push('', `## ${section.title}`, '')
    for (const entry of section.entries) {
      const title = entry.title ?? entry.segments[entry.segments.length - 1] ?? ''
      const url = new URL(`/${entry.segments.join('/')}.md`, site.serverUrl).toString()
      lines.push(
        entry.description ? `- [${title}](${url}): ${entry.description}` : `- [${title}](${url})`
      )
    }
  }
  return `${lines.join('\n')}\n`
}
