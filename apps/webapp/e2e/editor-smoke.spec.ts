/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Editor smoke suite — browser-level happy paths over the document editor.
 *
 * Scope (per docs/TODO.md → "Admin editor smoke suite"): ~10–15 happy-path
 * scenarios, not coverage. Runs serially against the seeded `byline_dev`
 * database (`pnpm tsx byline/seed.ts`); flows that mutate documents create
 * their own document first so reruns stay clean.
 *
 * Growth plan (one scenario per editor surface):
 *   - [x] dashboard + collection list render
 *   - [x] create document → edit title → save → patch round-trip
 *   - [x] status transition on a saved document
 *   - [ ] each remaining field type (datetime, select, checkbox, relation, richtext)
 *   - [ ] file upload (media collection)
 *   - [ ] content-locale switch + translation save
 *   - [ ] duplicate / restore-version flows
 */

import { expect, test } from '@playwright/test'

test.describe('admin shell', () => {
  test('dashboard renders the collections overview', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('link', { name: /Documents/ }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /Media/ }).first()).toBeVisible()
  })

  test('docs collection list view renders rows', async ({ page }) => {
    await page.goto('/admin/collections/docs')
    // The seeded dataset guarantees at least one row; the list renders as a table.
    await expect(page.getByRole('table')).toBeVisible()
    await expect(page.getByRole('row').nth(1)).toBeVisible()
  })
})

test.describe('document editor', () => {
  // The edit view of a saved document lives at /admin/collections/docs/<uuid>
  // — match "not /create" so the wait can't be satisfied by the create URL.
  const editViewUrl = /\/admin\/collections\/docs\/(?!create)[0-9a-f-]{36}/

  /**
   * Wait until React has attached handlers to the element — fills that land
   * before hydration set the native value without reaching the form context,
   * so the dirty-gated Save button never enables. The editor graph is
   * code-split and compiles on first visit in dev, so this window is wide.
   */
  async function waitForHydration(page: import('@playwright/test').Page, selector: string) {
    await page.waitForFunction(
      (sel) => {
        const el = document.querySelector(sel)
        return el != null && Object.keys(el).some((k) => k.startsWith('__reactProps'))
      },
      selector,
      { timeout: 30_000 }
    )
  }

  async function createDoc(page: import('@playwright/test').Page, title: string) {
    await page.goto('/admin/collections/docs/create')
    await waitForHydration(page, '#title')
    await page.locator('#title').fill(title)
    // Summary is the other required field on the docs collection.
    await page.locator('#summary').fill('Created by the editor smoke suite.')
    const save = page.getByRole('button', { name: 'Save', exact: true })
    await expect(save).toBeEnabled()
    await save.click()
    // A successful create navigates to the edit view of the new document.
    await page.waitForURL(editViewUrl)
    // The edit route strips `?action=created` (after firing the created
    // toast) with a replace navigation that re-runs the loader and resets
    // the form — wait for it to settle before editing.
    await page.waitForURL((url) => !url.searchParams.has('action'))
    await waitForHydration(page, '#title')
  }

  test('create → edit title → save → reload round-trip', async ({ page }) => {
    const title = `Smoke test ${Date.now()}`
    await createDoc(page, title)

    // Edit the title and save (patch-based update path).
    const editedTitle = `${title} (edited)`
    await page.locator('#title').fill(editedTitle)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Successfully updated', { exact: false }).first()).toBeVisible()

    // Reload — the persisted version must carry the edit.
    await page.reload()
    await expect(page.locator('#title')).toHaveValue(editedTitle)
  })

  test('status transition: draft → needs review', async ({ page }) => {
    await createDoc(page, `Smoke status ${Date.now()}`)

    // The docs workflow is draft → needs_review → published → archived;
    // the transition button carries the workflow verb.
    await page.getByRole('button', { name: 'Request Review' }).click()
    await expect(page.getByText('Needs Review', { exact: false }).first()).toBeVisible()
  })
})
