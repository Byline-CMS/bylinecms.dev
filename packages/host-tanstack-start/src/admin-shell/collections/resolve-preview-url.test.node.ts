/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Tests for the preview-URL resolver's three-level cascade:
 *
 *   1. `adminConfig.preview.url`       — wins outright
 *   2. `definition.buildDocumentPath`  — schema-side fallback
 *   3. Generic `/${collectionPath}/${path}` — last-resort compose
 *
 * Also covers the branch-A posture (hook throws → fall through) and the
 * "missing path means hide affordance" contract.
 */

import {
  type CollectionAdminConfig,
  type CollectionDefinition,
  defineServerConfig,
  type PreviewDocument,
} from '@byline/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolvePreviewUrl } from './resolve-preview-url.js'

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function clearConfig(): void {
  ;(globalThis as any)[Symbol.for('__byline_server_config__')] = null
  ;(globalThis as any)[Symbol.for('__byline_client_config__')] = null
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
  } as Parameters<typeof defineServerConfig>[0])
}

const doc: PreviewDocument = {
  id: 'doc-1',
  path: 'about',
  status: 'published',
  fields: { title: 'About' },
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('resolvePreviewUrl', () => {
  beforeEach(clearConfig)
  afterEach(clearConfig)

  // -------------------------------------------------------------------------
  // Tier 1 — adminConfig.preview.url
  // -------------------------------------------------------------------------

  describe('adminConfig.preview.url', () => {
    it('takes precedence over the schema hook', () => {
      registerCollection({
        path: 'pages',
        buildDocumentPath: () => '/schema-path',
      })
      const adminConfig = {
        preview: { url: () => '/from-admin' },
      } as unknown as CollectionAdminConfig
      expect(resolvePreviewUrl(doc, 'pages', adminConfig, undefined)).toBe('/from-admin')
    })

    it('forwards the locale to the configured url builder', () => {
      const calls: Array<{ locale: string | undefined }> = []
      const adminConfig = {
        preview: {
          url: (_d: PreviewDocument, ctx: { locale?: string }) => {
            calls.push({ locale: ctx.locale })
            return '/anything'
          },
        },
      } as unknown as CollectionAdminConfig
      resolvePreviewUrl(doc, 'pages', adminConfig, 'fr')
      expect(calls).toEqual([{ locale: 'fr' }])
    })

    it('returns null when the configured url builder returns null', () => {
      const adminConfig = {
        preview: { url: () => null },
      } as unknown as CollectionAdminConfig
      expect(resolvePreviewUrl(doc, 'pages', adminConfig, undefined)).toBeNull()
    })
  })

  // -------------------------------------------------------------------------
  // Tier 2 — schema-side buildDocumentPath
  // -------------------------------------------------------------------------

  describe('buildDocumentPath fallback', () => {
    it('uses the schema hook when no adminConfig.preview is set', () => {
      registerCollection({
        path: 'pages',
        buildDocumentPath: (d) => `/marketing/${d.path}`,
      })
      expect(resolvePreviewUrl(doc, 'pages', undefined, undefined)).toBe('/marketing/about')
    })

    it('passes through null to hide the preview affordance', () => {
      registerCollection({
        path: 'pages',
        buildDocumentPath: () => null,
      })
      expect(resolvePreviewUrl(doc, 'pages', undefined, undefined)).toBeNull()
    })

    it('falls through to generic compose when the hook throws (branch-A posture)', () => {
      registerCollection({
        path: 'pages',
        buildDocumentPath: () => {
          throw new Error('boom')
        },
      })
      expect(resolvePreviewUrl(doc, 'pages', undefined, undefined)).toBe('/pages/about')
    })

    it('falls through to generic compose when the hook returns a non-string non-null', () => {
      registerCollection({
        path: 'pages',
        // @ts-expect-error — exercising defensive handling of malformed return values
        buildDocumentPath: () => 42,
      })
      expect(resolvePreviewUrl(doc, 'pages', undefined, undefined)).toBe('/pages/about')
    })
  })

  // -------------------------------------------------------------------------
  // Tier 3 — generic compose
  // -------------------------------------------------------------------------

  describe('generic compose', () => {
    it('uses /${collectionPath}/${path} when no schema hook is defined', () => {
      registerCollection({ path: 'pages' })
      expect(resolvePreviewUrl(doc, 'pages', undefined, undefined)).toBe('/pages/about')
    })

    it('works without any registered collection (fully unconfigured host)', () => {
      // No registerCollection — getCollectionDefinition returns null,
      // the cascade falls straight through to the generic compose.
      expect(resolvePreviewUrl(doc, 'pages', undefined, undefined)).toBe('/pages/about')
    })

    it('returns null when the doc has no path yet', () => {
      registerCollection({ path: 'pages' })
      expect(resolvePreviewUrl({ ...doc, path: '' }, 'pages', undefined, undefined)).toBeNull()
    })
  })
})
