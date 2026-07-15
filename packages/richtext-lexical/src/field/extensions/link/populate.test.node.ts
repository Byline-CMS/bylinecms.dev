/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Fixture-driven tests for the link visitor's three resolution branches:
 *
 *   - Found              — target resolved, `buildDocumentPath` returned a string
 *   - Found (fallback)   — target resolved, generic `/${collectionPath}/${path}` compose
 *   - Branch A (threw)   — `buildDocumentPath` raised
 *   - Branch B (missing) — target deleted between picker and walker
 *
 * The visitor itself is framework-agnostic and exercised directly: build
 * a `LexicalNodeLike`, call `linkVisitor.match(node)`, then invoke the
 * returned `apply` / `applyMissing` and assert on the mutated `node`.
 *
 * Branch C (hard transport failures) is owned by the framework caller
 * (`embedRichTextFields`) and tested in `packages/core` against that
 * service — see `richtext-embed.test.node.ts`.
 */

import { type BylineLogger, type CollectionDefinition, defineServerConfig } from '@byline/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { linkVisitor } from './populate'
import type { LexicalNodeLike } from '../../lexical-populate-shared'

// ---------------------------------------------------------------------------
// Test harness — logger + config registration
// ---------------------------------------------------------------------------

function makeLogger(): BylineLogger {
  return {
    log: vi.fn(),
    fatal: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    silent: vi.fn(),
  }
}

function registerCollection(definition: Partial<CollectionDefinition> & { path: string }): void {
  defineServerConfig({
    collections: [
      {
        labels: { singular: 'Page', plural: 'Pages' },
        fields: [{ name: 'title', type: 'text', label: 'Title' }],
        useAsTitle: 'title',
        ...definition,
      } as CollectionDefinition,
    ],
  } as unknown as Parameters<typeof defineServerConfig>[0])
}

function clearConfig(): void {
  // Mirror the config module's globalThis-symbol storage so tests can
  // register a fresh collection set per case without bleed-over.
  ;(globalThis as any)[Symbol.for('__byline_server_config__')] = null
  ;(globalThis as any)[Symbol.for('__byline_client_config__')] = null
}

function installLogger(logger: BylineLogger): void {
  // `defineLogger` is not re-exported from `@byline/core`'s root barrel —
  // setting the symbol directly mirrors what `initBylineCore()` does at
  // boot and avoids growing the public surface for test wiring.
  ;(globalThis as any)[Symbol.for('__byline_logger__')] = logger
}

// ---------------------------------------------------------------------------
// Node fixtures
// ---------------------------------------------------------------------------

function makeInternalLinkNode(opts: {
  documentId?: string
  collectionPath?: string
  document?: Record<string, any>
}): LexicalNodeLike {
  return {
    type: 'link',
    attributes: {
      linkType: 'internal',
      targetDocumentId: opts.documentId ?? 'doc-1',
      targetCollectionPath: opts.collectionPath ?? 'pages',
      document: opts.document,
    },
  }
}

const targetFixture = {
  id: 'doc-1',
  path: 'about',
  status: 'published',
  fields: { title: 'About Us', area: 'root' },
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('linkVisitor', () => {
  let logger: BylineLogger

  beforeEach(() => {
    logger = makeLogger()
    installLogger(logger)
    clearConfig()
  })

  afterEach(() => {
    clearConfig()
  })

  // -------------------------------------------------------------------------
  // match() — skip-conditions
  // -------------------------------------------------------------------------

  describe('match', () => {
    it('returns null for non-link nodes', () => {
      const node: LexicalNodeLike = { type: 'paragraph' }
      expect(linkVisitor.match(node)).toBeNull()
    })

    it('returns null for custom-URL links', () => {
      const node: LexicalNodeLike = {
        type: 'link',
        attributes: { linkType: 'custom', url: 'https://example.com' },
      }
      expect(linkVisitor.match(node)).toBeNull()
    })

    it('returns null when targetDocumentId is missing', () => {
      const node: LexicalNodeLike = {
        type: 'link',
        attributes: { linkType: 'internal', targetCollectionPath: 'pages' },
      }
      expect(linkVisitor.match(node)).toBeNull()
    })

    it('returns null when targetCollectionPath is missing', () => {
      const node: LexicalNodeLike = {
        type: 'link',
        attributes: { linkType: 'internal', targetDocumentId: 'doc-1' },
      }
      expect(linkVisitor.match(node)).toBeNull()
    })

    it('returns a PendingHydration for a well-formed internal link', () => {
      registerCollection({ path: 'pages' })
      const node = makeInternalLinkNode({})
      const pending = linkVisitor.match(node)
      expect(pending).not.toBeNull()
      expect(pending?.collectionPath).toBe('pages')
      expect(pending?.documentId).toBe('doc-1')
    })
  })

  // -------------------------------------------------------------------------
  // apply() — Found branches
  // -------------------------------------------------------------------------

  describe('apply (found)', () => {
    it('uses buildDocumentPath when defined and returning a string', () => {
      registerCollection({
        path: 'pages',
        useAsTitle: 'title',
        buildDocumentPath: (doc) => `/custom/${doc.path}`,
      })
      const node = makeInternalLinkNode({})
      const pending = linkVisitor.match(node)
      pending?.apply(targetFixture)

      expect(node.attributes?.document).toEqual({
        title: 'About Us',
        path: '/custom/about',
      })
    })

    it('falls back to generic compose when buildDocumentPath returns null', () => {
      registerCollection({
        path: 'pages',
        useAsTitle: 'title',
        buildDocumentPath: () => null,
      })
      const node = makeInternalLinkNode({})
      const pending = linkVisitor.match(node)
      pending?.apply(targetFixture)

      expect(node.attributes?.document?.path).toBe('/pages/about')
    })

    it('falls back to generic compose when buildDocumentPath is not defined', () => {
      registerCollection({ path: 'pages', useAsTitle: 'title' })
      const node = makeInternalLinkNode({})
      const pending = linkVisitor.match(node)
      pending?.apply(targetFixture)

      expect(node.attributes?.document?.path).toBe('/pages/about')
    })

    it('refreshes title from useAsTitle (defaults to "title" when not set)', () => {
      registerCollection({ path: 'pages' })
      const node = makeInternalLinkNode({
        document: { title: 'Stale Title', path: '/stale' },
      })
      const pending = linkVisitor.match(node)
      pending?.apply(targetFixture)

      expect(node.attributes?.document?.title).toBe('About Us')
    })

    it('honours a custom useAsTitle field', () => {
      registerCollection({
        path: 'pages',
        useAsTitle: 'headline',
        fields: [
          { name: 'title', type: 'text', label: 'Title' },
          { name: 'headline', type: 'text', label: 'Headline' },
        ],
      })
      const node = makeInternalLinkNode({})
      const pending = linkVisitor.match(node)
      pending?.apply({
        ...targetFixture,
        fields: { title: 'fallback', headline: 'Real Headline' },
      })

      expect(node.attributes?.document?.title).toBe('Real Headline')
    })

    it('clears a stale _resolved: false flag when the target is now found', () => {
      registerCollection({ path: 'pages' })
      const node = makeInternalLinkNode({
        document: { _resolved: false },
      })
      const pending = linkVisitor.match(node)
      pending?.apply(targetFixture)

      expect(node.attributes?.document?._resolved).toBeUndefined()
      expect(node.attributes?.document?.path).toBe('/pages/about')
    })

    it('leaves path untouched when target.path is empty and no hook is defined', () => {
      // Generic fallback bails when target.path is empty rather than
      // emitting `/pages/undefined`.
      registerCollection({ path: 'pages' })
      const node = makeInternalLinkNode({
        document: { title: 'Old', path: '/previous' },
      })
      const pending = linkVisitor.match(node)
      pending?.apply({ ...targetFixture, path: '' })

      expect(node.attributes?.document?.path).toBe('/previous')
    })
  })

  // -------------------------------------------------------------------------
  // apply() — Branch A: buildDocumentPath threw
  // -------------------------------------------------------------------------

  describe('apply (branch A — hook threw)', () => {
    it('logs at info and leaves document.path untouched', () => {
      registerCollection({
        path: 'pages',
        useAsTitle: 'title',
        buildDocumentPath: () => {
          throw new Error('boom')
        },
      })
      const node = makeInternalLinkNode({
        document: { title: 'Previous', path: '/previous' },
      })
      const pending = linkVisitor.match(node)
      pending?.apply(targetFixture)

      // Path preserved (branch A's whole point).
      expect(node.attributes?.document?.path).toBe('/previous')
      // Title still refreshes — only the path resolution failed.
      expect(node.attributes?.document?.title).toBe('About Us')
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          collectionPath: 'pages',
          documentId: 'doc-1',
          err: expect.any(Error),
        }),
        'buildDocumentPath threw'
      )
    })

    it('does not fall back to generic compose when the hook threw', () => {
      registerCollection({
        path: 'pages',
        buildDocumentPath: () => {
          throw new Error('boom')
        },
      })
      const node = makeInternalLinkNode({ document: {} })
      const pending = linkVisitor.match(node)
      pending?.apply(targetFixture)

      // No path written — neither hook output nor generic fallback fired.
      expect(node.attributes?.document?.path).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // applyMissing() — Branch B: target deleted
  // -------------------------------------------------------------------------

  describe('applyMissing (branch B — target deleted)', () => {
    it('deletes title and path and sets _resolved: false', () => {
      registerCollection({ path: 'pages' })
      const node = makeInternalLinkNode({
        document: { title: 'Stale', path: '/stale-path' },
      })
      const pending = linkVisitor.match(node)
      pending?.applyMissing?.()

      expect(node.attributes?.document?.title).toBeUndefined()
      expect(node.attributes?.document?.path).toBeUndefined()
      expect(node.attributes?.document?._resolved).toBe(false)
    })

    it('logs at warn level', () => {
      registerCollection({ path: 'pages' })
      const node = makeInternalLinkNode({ document: { title: 'Stale' } })
      const pending = linkVisitor.match(node)
      pending?.applyMissing?.()

      expect(logger.warn).toHaveBeenCalledWith(
        { collectionPath: 'pages', documentId: 'doc-1' },
        'internal link target not found'
      )
    })

    it('still produces a usable envelope when no prior document was present', () => {
      registerCollection({ path: 'pages' })
      const node = makeInternalLinkNode({})
      const pending = linkVisitor.match(node)
      pending?.applyMissing?.()

      expect(node.attributes?.document).toEqual({ _resolved: false })
    })
  })
})
