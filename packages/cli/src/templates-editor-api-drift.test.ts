/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Shipped examples must not use editor APIs that no longer exist.
 *
 * `tsconfig.json` excludes `src/templates` from typechecking — templates
 * are source for a generated app, not for this package, and their
 * imports only resolve once scaffolded. That exclusion is reasonable and
 * it has a cost: nothing tells you when an example drifts away from the
 * API it demonstrates. It is how `settings.options` survived in two
 * templates through the 6.0 rename, where it would have generated a
 * broken install.
 *
 * This is a blunt guard rather than a typecheck, but it catches the
 * class of drift that matters: an example calling into a surface that
 * was removed.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const templatesRoot = resolve(here, 'templates')

/**
 * Editor APIs removed in 6.0, with what replaced them.
 *
 * `textStyle` is deliberately absent: it is also the name of a property
 * on serialized Lexical text nodes, which the seed and Markdown-import
 * templates legitimately set. Matching it here would fail on those.
 */
const REMOVED: Array<{ pattern: RegExp; was: string; now: string }> = [
  {
    pattern: /settings\.options\b/,
    was: 'EditorSettings.options',
    now: 'settings.mode / settings.markdownShortcuts / settings.controls / settings.debug',
  },
  {
    pattern: /\bmarkdownShortcutPlugin\b/,
    was: 'options.markdownShortcutPlugin',
    now: 'settings.markdownShortcuts',
  },
  {
    pattern: /\bshowTreeView\b/,
    was: 'options.showTreeView',
    now: 'settings.controls.treeView',
  },
  {
    pattern: /\bfrom '@byline\/richtext-lexical'[\s\S]{0,80}\bNodes\b/,
    was: 'the Nodes export',
    now: 'READABLE_NODES, which is a read vocabulary rather than a registration list',
  },
]

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full))
    } else if (/\.tsx?$/.test(entry)) {
      found.push(full)
    }
  }
  return found
}

describe('shipped templates track the editor API', () => {
  const files = sourceFiles(templatesRoot)

  it('finds templates to check', () => {
    // Guards the guard: a walk that silently returns nothing would make
    // every assertion below vacuous.
    expect(files.length).toBeGreaterThan(20)
  })

  for (const { pattern, was, now } of REMOVED) {
    it(`uses no ${was}`, () => {
      const offenders = files
        .filter((file) => pattern.test(readFileSync(file, 'utf8')))
        .map((file) => file.slice(templatesRoot.length + 1))

      expect(offenders, `${was} was removed in 6.0 — use ${now}`).toEqual([])
    })
  }
})
