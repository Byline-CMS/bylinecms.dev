/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Which extensions the minimal and compact presets resolve to.
 *
 * Both used to hide controls while still storing whatever a paste
 * carried — which is how a heading reached an inline-only title field.
 * Removing an extension now removes its node registration too, so the
 * presets' removal lists are what make their restrictions real.
 *
 * These assert the resolved list rather than pasting into an editor on
 * purpose. That an unregistered structure cannot arrive by paste,
 * Markdown or storage is proven exhaustively in
 * `@byline/richtext-lexical`; repeating it here would test that package
 * again. What is unproven, and what belongs in the app, is whether these
 * two presets remove the RIGHT set.
 */

// The root barrel, not `/config`: the light config subpath deliberately
// carries no extension list, and this needs a real one to resolve against.
import { builtInExtensions, defaultClientEditorConfig } from '@byline/richtext-lexical'
import { describe, expect, it } from 'vitest'

import { configurePhotoCaptionEditor } from '../../byline/blocks/photo-block.admin'
import { configureQuoteTextEditor } from '../../byline/blocks/quote-block.admin'
import { configureCompactEditor } from '../../byline/fields/richtext/lexical-richtext-compact-admin'
import { configureMinimalEditor } from '../../byline/fields/richtext/lexical-richtext-minimal-admin'

/**
 * The extension names a preset leaves in place.
 *
 * Read off the preset's own configure callback rather than restated
 * here — a test that duplicated the removals would keep passing if the
 * preset stopped applying them.
 */
function resolvedNames(configure: (config: any) => any): string[] {
  const seed = {
    ...defaultClientEditorConfig,
    settings: { ...defaultClientEditorConfig.settings },
    extensions: defaultClientEditorConfig.extensions?.clone(),
  }
  const resolved = configure(seed)
  return (resolved.extensions?.toArray() ?? []).map((entry: any) =>
    Array.isArray(entry) ? entry[0]?.name : entry?.name
  )
}

/** Structures neither preset should accept. */
const BLOCK_STRUCTURES = [
  builtInExtensions.Heading,
  builtInExtensions.Quote,
  builtInExtensions.List,
  builtInExtensions.CheckList,
  builtInExtensions.Table,
  builtInExtensions.Layout,
  builtInExtensions.Admonition,
  builtInExtensions.HorizontalRule,
  builtInExtensions.CodeHighlight,
  builtInExtensions.YouTube,
  builtInExtensions.Vimeo,
]

describe('the minimal preset', () => {
  const names = resolvedNames(configureMinimalEditor)

  it.each(BLOCK_STRUCTURES)('removes %s', (name) => {
    expect(names).not.toContain(name)
  })

  it('removes links too — minimal means inline formatting only', () => {
    expect(names).not.toContain(builtInExtensions.Link)
    expect(names).not.toContain(builtInExtensions.AutoLink)
  })

  it('keeps the toolbar infrastructure it still needs', () => {
    expect(names).toContain(builtInExtensions.Toolbar)
  })
})

describe('the compact preset', () => {
  const names = resolvedNames(configureCompactEditor)

  it.each(BLOCK_STRUCTURES)('removes %s', (name) => {
    expect(names).not.toContain(name)
  })

  it('keeps links, because captions carry credits', () => {
    expect(names).toContain(builtInExtensions.Link)
  })

  it('keeps inline images', () => {
    expect(names).toContain(builtInExtensions.InlineImage)
  })
})

describe('the registered block editors', () => {
  // The presets above are only half the story: these are the editors a
  // caption and a pull-quote ACTUALLY render. They previously carried
  // their own removal chains, so narrowing the shared preset left them
  // untouched — a caption offering no block controls while still storing
  // a heading that arrived by paste.
  const editors: Array<[string, (config: any) => any]> = [
    ['photo caption', configurePhotoCaptionEditor],
    ['pull-quote text', configureQuoteTextEditor],
  ]

  for (const [name, configure] of editors) {
    const names = resolvedNames(configure)

    it.each(BLOCK_STRUCTURES)(`${name} removes %s`, (extensionName) => {
      expect(names).not.toContain(extensionName)
    })

    it(`${name} keeps links, because credits carry them`, () => {
      // AutoLink is not in the default list, so only Link is asserted.
      expect(names).toContain(builtInExtensions.Link)
    })

    it(`${name} removes inline images — no image inside a caption`, () => {
      expect(names).not.toContain(builtInExtensions.InlineImage)
    })
  }
})
