/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Rewrite relative markdown links so they work after import.
 *
 * Markdown docs commonly link to siblings via `./OTHER.md[#hash]`. Once
 * imported into Lexical, those hrefs break — Lexical's link serializer
 * passes them to `new URL(...)` and throws. We rewrite them in-place
 * against a `sourcePath → importedDocPath` map built in a pre-pass.
 *
 * Links whose target isn't in the map (i.e. the .md file wasn't part of
 * the same import batch) are stripped: the `link` node is replaced by
 * its inline children, so the reader sees the link text but no broken
 * URL. The original href is reported as a warning.
 *
 * Non-markdown hrefs (absolute URLs, mailto:, pure fragments, images,
 * etc.) are left untouched.
 */

import { dirname, resolve } from 'node:path'

import type { Parent, Root, RootContent } from 'mdast'

export interface DocLinkRewriteWarning {
  kind: 'rewritten-doc-link' | 'unresolved-doc-link' | 'stripped-empty-link'
  href: string
  resolvedTo?: string
}

export interface RewriteDocLinksOptions {
  /** Absolute path of the markdown file currently being converted. */
  sourceFilePath: string
  /** Map from absolute markdown source path → imported doc path (no leading slash). */
  pathMap: Map<string, string>
  /** URL prefix the imported docs live under, e.g. `/docs`. */
  urlPrefix: string
}

const MD_EXT_RE = /\.(md|markdown)$/i
// A leading `scheme:` like `https:`, `mailto:`, `data:` — anything we
// must not touch.
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

export function rewriteDocLinks(root: Root, opts: RewriteDocLinksOptions): DocLinkRewriteWarning[] {
  const warnings: DocLinkRewriteWarning[] = []
  const baseDir = dirname(opts.sourceFilePath)
  const prefix = opts.urlPrefix.replace(/\/$/, '')
  rewriteChildren(root as unknown as Parent, baseDir, prefix, opts.pathMap, warnings)
  return warnings
}

function rewriteChildren(
  parent: Parent,
  baseDir: string,
  prefix: string,
  pathMap: Map<string, string>,
  warnings: DocLinkRewriteWarning[]
): void {
  const next: RootContent[] = []
  for (const child of parent.children as RootContent[]) {
    if (child.type === 'link') {
      const decision = classifyLink(child.url, baseDir, pathMap)
      if (decision.kind === 'skip') {
        // Still recurse — a link may contain other links via images, etc.
        rewriteChildren(child as unknown as Parent, baseDir, prefix, pathMap, warnings)
        next.push(child)
      } else if (decision.kind === 'rewrite') {
        const newUrl = `${prefix}/${decision.docPath}${decision.fragment}`
        warnings.push({
          kind: 'rewritten-doc-link',
          href: child.url,
          resolvedTo: newUrl,
        })
        child.url = newUrl
        rewriteChildren(child as unknown as Parent, baseDir, prefix, pathMap, warnings)
        next.push(child)
      } else {
        // Unresolved .md or empty/meaningless target — drop the link
        // wrapper, keep the text so the reader still sees the prose.
        warnings.push({
          kind: decision.kind === 'unresolved' ? 'unresolved-doc-link' : 'stripped-empty-link',
          href: child.url,
        })
        rewriteChildren(child as unknown as Parent, baseDir, prefix, pathMap, warnings)
        for (const inner of child.children) next.push(inner as RootContent)
      }
    } else {
      if (hasChildren(child)) {
        rewriteChildren(child, baseDir, prefix, pathMap, warnings)
      }
      next.push(child)
    }
  }
  parent.children = next as Parent['children']
}

type Decision =
  | { kind: 'skip' }
  | { kind: 'rewrite'; docPath: string; fragment: string }
  | { kind: 'unresolved' }
  | { kind: 'empty' }

// Targets that reference "the current directory" with no real path —
// `.`, `..`, `./`, `../`, etc. Authors sometimes write `[text](.)` as a
// placeholder; in the rendered doc it has no meaning and Lexical's
// link serializer crashes on it.
const EMPTY_TARGET_RE = /^\.{1,2}\/?$/

function classifyLink(
  url: string | undefined | null,
  baseDir: string,
  pathMap: Map<string, string>
): Decision {
  if (url == null) return { kind: 'skip' }
  if (url.length === 0) return { kind: 'empty' }
  if (url.startsWith('#')) return { kind: 'skip' }
  if (url.startsWith('//')) return { kind: 'skip' }
  if (SCHEME_RE.test(url)) return { kind: 'skip' }

  const hashIdx = url.indexOf('#')
  const target = hashIdx >= 0 ? url.slice(0, hashIdx) : url
  const fragment = hashIdx >= 0 ? url.slice(hashIdx) : ''

  if (target.length === 0 || EMPTY_TARGET_RE.test(target)) return { kind: 'empty' }
  if (!MD_EXT_RE.test(target)) return { kind: 'skip' }

  const abs = resolve(baseDir, target)
  const mapped = pathMap.get(abs)
  if (mapped) return { kind: 'rewrite', docPath: mapped, fragment }
  return { kind: 'unresolved' }
}

function hasChildren(node: RootContent): node is RootContent & Parent {
  return 'children' in node && Array.isArray((node as Parent).children)
}
