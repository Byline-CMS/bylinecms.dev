/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

import { dirname, resolve } from 'node:path'

import { formatTextValue, slugify } from '@byline/core'
import type { Heading, Link, Parent, Root, RootContent } from 'mdast'
import { toString as mdastToString } from 'mdast-util-to-string'

import { parseDocFile } from './frontmatter.js'
import { buildCanonicalSourcePathMap } from './import-docs-tree.js'
import { parseBodyToMdast } from './parse-markdown.js'
import { stripLeadingH1IfMatches } from './strip-leading-h1.js'

export interface DocSource {
  filePath: string
  source: string
}

export interface DocCheckIssue {
  filePath: string
  line: number
  kind:
    | 'duplicate-route'
    | 'leading-h1-mismatch'
    | 'missing-fragment'
    | 'parse-error'
    | 'relative-non-document'
    | 'unresolved-document'
  detail: string
}

export interface DocCheckResult {
  documents: number
  links: number
  issues: DocCheckIssue[]
}

interface ParsedSource {
  filePath: string
  title: string
  path: string
  root: Root
}

const MARKDOWN_EXT_RE = /\.(md|markdown)$/i
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

function lineOf(node: RootContent): number {
  return node.position?.start.line ?? 1
}

function collectLinks(root: Root): Link[] {
  const links: Link[] = []
  const visit = (node: RootContent | Root): void => {
    if (node.type === 'link') links.push(node)
    if ('children' in node) {
      for (const child of (node as Parent).children as RootContent[]) visit(child)
    }
  }
  visit(root)
  return links
}

function collectHeadingIds(root: Root): Set<string> {
  const ids = new Set<string>()
  const visit = (node: RootContent | Root): void => {
    if (node.type === 'heading') {
      ids.add(formatTextValue(mdastToString(node as Heading)))
    }
    if ('children' in node) {
      for (const child of (node as Parent).children as RootContent[]) visit(child)
    }
  }
  visit(root)
  return ids
}

function parseFragment(fragment: string): string {
  const raw = fragment.replace(/^#/, '')
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function splitTarget(url: string): { target: string; fragment: string } {
  const hashIndex = url.indexOf('#')
  return hashIndex < 0
    ? { target: url, fragment: '' }
    : { target: url.slice(0, hashIndex), fragment: url.slice(hashIndex) }
}

export function checkDocSources(
  sources: readonly DocSource[],
  defaultLocale = 'en'
): DocCheckResult {
  const issues: DocCheckIssue[] = []
  const parsed: ParsedSource[] = []

  for (const source of sources) {
    try {
      const document = parseDocFile(source.source, source.filePath)
      const locale = document.frontmatter.locale ?? defaultLocale
      const path =
        document.frontmatter.path ??
        slugify(document.frontmatter.title, { locale, collectionPath: 'docs' })
      const parsedRoot = parseBodyToMdast(document.body)
      const first = parsedRoot.children[0]
      if (
        first?.type === 'heading' &&
        first.depth === 1 &&
        mdastToString(first).trim().toLowerCase() !== document.frontmatter.title.toLowerCase()
      ) {
        issues.push({
          filePath: source.filePath,
          line: lineOf(first),
          kind: 'leading-h1-mismatch',
          detail: `leading H1 '${mdastToString(first)}' does not match frontmatter title '${document.frontmatter.title}' and will render as a duplicate title`,
        })
      }
      const root = stripLeadingH1IfMatches(parsedRoot, document.frontmatter.title)
      parsed.push({ filePath: source.filePath, title: document.frontmatter.title, path, root })
    } catch (error) {
      issues.push({
        filePath: source.filePath,
        line: 1,
        kind: 'parse-error',
        detail: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const canonicalPathByFile = buildCanonicalSourcePathMap(parsed)
  const documentByFile = new Map(parsed.map((document) => [document.filePath, document]))
  const fileByCanonicalRoute = new Map<string, string>()
  const headingIdsByFile = new Map(
    parsed.map((document) => [document.filePath, collectHeadingIds(document.root)])
  )

  for (const document of parsed) {
    const route = canonicalPathByFile.get(document.filePath)
    if (route == null) continue
    const existing = fileByCanonicalRoute.get(route)
    if (existing != null) {
      issues.push({
        filePath: document.filePath,
        line: 1,
        kind: 'duplicate-route',
        detail: `canonical route '/docs/${route}' is also produced by ${existing}`,
      })
    } else {
      fileByCanonicalRoute.set(route, document.filePath)
    }
  }

  let links = 0
  for (const document of parsed) {
    for (const link of collectLinks(document.root)) {
      links += 1
      const url = link.url
      if (
        url.length === 0 ||
        url.startsWith('//') ||
        SCHEME_RE.test(url) ||
        (url.startsWith('/') && !url.startsWith('/docs/'))
      ) {
        continue
      }

      const { target, fragment } = splitTarget(url)
      let targetFile: string | undefined

      if (target.length === 0) {
        targetFile = document.filePath
      } else if (target.startsWith('/docs/')) {
        targetFile = fileByCanonicalRoute.get(target.slice('/docs/'.length).replace(/\/+$/, ''))
        if (targetFile == null) {
          issues.push({
            filePath: document.filePath,
            line: lineOf(link),
            kind: 'unresolved-document',
            detail: `'${url}' does not match a canonical docs route`,
          })
          continue
        }
      } else if (MARKDOWN_EXT_RE.test(target)) {
        const resolvedTarget = resolve(dirname(document.filePath), target)
        targetFile = documentByFile.get(resolvedTarget)?.filePath
        if (targetFile == null) {
          issues.push({
            filePath: document.filePath,
            line: lineOf(link),
            kind: 'unresolved-document',
            detail: `'${url}' is not part of the import set`,
          })
          continue
        }
      } else {
        issues.push({
          filePath: document.filePath,
          line: lineOf(link),
          kind: 'relative-non-document',
          detail: `'${url}' would be resolved relative to the published docs route`,
        })
        continue
      }

      if (fragment.length > 1) {
        const fragmentId = parseFragment(fragment)
        if (!headingIdsByFile.get(targetFile)?.has(fragmentId)) {
          issues.push({
            filePath: document.filePath,
            line: lineOf(link),
            kind: 'missing-fragment',
            detail: `'${url}' targets missing heading id '${fragmentId}'`,
          })
        }
      }
    }
  }

  return { documents: parsed.length, links, issues }
}
