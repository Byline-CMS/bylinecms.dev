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
 * Scope (per TODO-INTERNAL.md → "Admin editor smoke suite"): ~10–15 happy-path
 * scenarios, not coverage. Runs serially against the seeded `byline_dev`
 * database (`pnpm tsx byline/seed.ts`). All create/mutate flows run against the
 * `pages` collection — chosen because it exercises every field surface
 * (text / textArea / select / relation / datetime / blocks→richtext+checkbox)
 * and keeps the suite's throwaway documents out of the `docs` collection. Each
 * flow creates its own page first so reruns stay self-contained.
 *
 * Growth plan (one scenario per editor surface):
 *   - [x] dashboard + collection list render
 *   - [x] create document → edit title → save → patch round-trip
 *   - [x] status transition on a saved document
 *   - [x] datetime field (sidebar DatePicker) round-trip
 *   - [x] richtext-in-blocks (add block → type in Lexical) round-trip
 *   - [x] select field (`area`) round-trip
 *   - [x] checkbox field (block `constrainedWidth`) round-trip
 *   - [x] relation field (`featureImage` picker) round-trip
 *   - [x] hasMany relation (`gallery` tiles: add / remove) round-trip
 *   - [x] file upload (media collection)
 *   - [x] content-locale switch + translation save
 *   - [x] duplicate flow
 *   - [x] restore-version flow
 */

import { expect, test } from '@playwright/test'

test.describe('admin shell', () => {
  test('dashboard renders the collections overview', async ({ page }) => {
    await page.goto('/admin')
    await expect(page.getByRole('link', { name: /Pages/ }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: /Media/ }).first()).toBeVisible()
  })

  test('pages collection list view renders rows', async ({ page }) => {
    await page.goto('/admin/collections/pages')
    // The seeded dataset guarantees at least one row; the list renders as a table.
    await expect(page.getByRole('table')).toBeVisible()
    await expect(page.getByRole('row').nth(1)).toBeVisible()
  })
})

test.describe('document editor', () => {
  // Smoke flows run against the `pages` collection so they never write into
  // `docs`. The edit view of a saved page lives at
  // /admin/collections/pages/<uuid> — match "not /create" so the wait can't be
  // satisfied by the create URL.
  const editViewUrl = /\/admin\/collections\/pages\/(?!create)[0-9a-f-]{36}/

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

  async function createPage(page: import('@playwright/test').Page, title: string) {
    await page.goto('/admin/collections/pages/create')
    await waitForHydration(page, '#title')
    await page.locator('#title').fill(title)
    // Summary is the other required text field on the pages collection; `area`
    // (select) defaults to Root and `publishedOn` (datetime) auto-seeds, so
    // title + summary are all that's needed to satisfy required-field validation.
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
    await createPage(page, title)

    // Edit the title and save (patch-based update path).
    const editedTitle = `${title} (edited)`
    await page.locator('#title').fill(editedTitle)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Successfully updated', { exact: false }).first()).toBeVisible()

    // Reload — the persisted version must carry the edit.
    await page.reload()
    await expect(page.locator('#title')).toHaveValue(editedTitle)
  })

  test('status transition: draft → published', async ({ page }) => {
    await createPage(page, `Smoke status ${Date.now()}`)

    // The pages workflow is draft → published → archived; the primary
    // transition button from draft carries the "Publish" verb. Exact-match
    // "Published" so the assertion can't be satisfied by the "Published On"
    // field label in the sidebar.
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.getByText('Published', { exact: true }).first()).toBeVisible()
  })

  test('datetime field: pick a calendar day → save → reload round-trip', async ({ page }) => {
    await createPage(page, `Smoke datetime ${Date.now()}`)

    // `publishedOn` is a required datetime rendered in the sidebar (so it's
    // always visible — no tab switch needed). Its DatePicker input is
    // read-only; clicking it opens a calendar popover (portaled to <body>).
    // Because the field is required it auto-seeds to "now" on mount, so the
    // round-trip changes it deterministically: selecting a calendar day
    // re-applies the picker's default 08:00 time regardless of which day, so
    // the persisted value is fixed no matter when the suite runs.
    await waitForHydration(page, '#publishedOn')
    const seeded = await page.locator('#publishedOn').inputValue()
    await page.locator('#publishedOn').click()

    // Pick the 15th of the displayed month from the calendar grid (the time
    // column is outside the grid, so the day number is unambiguous there).
    await page.getByRole('grid').getByText('15', { exact: true }).click()
    await page.getByRole('button', { name: 'Select', exact: true }).click()

    // Selecting a day applies the 08:00 default time; value is `PP HH:mm`
    // (e.g. "Jun 15, 2026 08:00"), and must differ from the auto-seeded value.
    await expect(page.locator('#publishedOn')).toHaveValue(/08:00$/)
    expect(await page.locator('#publishedOn').inputValue()).not.toBe(seeded)

    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Successfully updated', { exact: false }).first()).toBeVisible()

    await page.reload()
    await waitForHydration(page, '#publishedOn')
    await expect(page.locator('#publishedOn')).toHaveValue(/08:00$/)
  })

  test('select field: change area → save → reload round-trip', async ({ page }) => {
    await createPage(page, `Smoke select ${Date.now()}`)

    // `area` is a select in the Details tab (the default active tab) that
    // defaults to "Root". The trigger is a button (#area); the options render
    // in a portaled listbox as `role="option"`.
    await waitForHydration(page, '#area')
    await expect(page.locator('#area')).toContainText('Root')
    await page.locator('#area').click()
    await page.getByRole('option', { name: 'Legal', exact: true }).click()
    await expect(page.locator('#area')).toContainText('Legal')

    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Successfully updated', { exact: false }).first()).toBeVisible()

    await page.reload()
    await waitForHydration(page, '#area')
    await expect(page.locator('#area')).toContainText('Legal')
  })

  test('relation field: pick featureImage → save → reload round-trip', async ({ page }) => {
    await createPage(page, `Smoke relation ${Date.now()}`)

    // `featureImage` is a relation to the media collection, in the Details tab
    // (the default active tab). The empty state renders an open button
    // (#featureImage); clicking it opens the picker modal listing media rows.
    await waitForHydration(page, '#featureImage')
    await page.locator('#featureImage').click()

    // Rows load async via the field-services list fn. Pick the first one and
    // capture its title (the first non-empty text line of the row) so we can
    // assert the same media still shows after a reload.
    const firstRow = page.locator('.byline-field-relation-picker-row-button').first()
    await expect(firstRow).toBeVisible({ timeout: 30_000 })
    const pickedTitle = (await firstRow.innerText())
      .split('\n')
      .map((s) => s.trim())
      .find((s) => s.length > 0) as string
    await firstRow.click()
    // Confirm the selection — the picker's primary action, distinct from the
    // empty-state open button labelled "Select Media Item…".
    await page.getByRole('button', { name: 'Select', exact: true }).click()

    // Selection replaces the open button with a summary tile + Change/Remove
    // controls; the summary renders the same columns as the picker row.
    const relationField = page.locator('.byline-field-relation.featureImage')
    await expect(page.getByRole('button', { name: 'Remove Media Item' })).toBeVisible()
    await expect(relationField).toContainText(pickedTitle)

    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Successfully updated', { exact: false }).first()).toBeVisible()

    await page.reload()
    await waitForHydration(page, '#title')
    await expect(page.getByRole('button', { name: 'Remove Media Item' })).toBeVisible()
    await expect(page.locator('.byline-field-relation.featureImage')).toContainText(pickedTitle)
  })

  test('relation column: pages list renders the featureImage title', async ({ page }) => {
    const title = `Smoke relcol ${Date.now()}`
    await createPage(page, title)

    // Set featureImage to the first media item and capture its title.
    await waitForHydration(page, '#featureImage')
    await page.locator('#featureImage').click()
    const row = page.locator('.byline-field-relation-picker-row-button').first()
    await expect(row).toBeVisible({ timeout: 30_000 })
    const mediaTitle = (await row.innerText())
      .split('\n')
      .map((s) => s.trim())
      .find((s) => s.length > 0) as string
    await row.click()
    await page.getByRole('button', { name: 'Select', exact: true }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Successfully updated', { exact: false }).first()).toBeVisible()

    // The pages list view should render the linked media's *title* in the
    // Feature Image column (relation column formatter + depth-1 list populate),
    // not a raw document id. Filter to this page via the list search so its row
    // is on the first page regardless of sort.
    await page.goto(`/admin/collections/pages?query=${encodeURIComponent(title)}`)
    await expect(page.getByRole('table')).toBeVisible()
    const pageRow = page.getByRole('row').filter({ hasText: title })
    await expect(pageRow).toContainText(mediaTitle)
  })

  test('hasMany relation: add gallery items → remove one → save → reload round-trip', async ({
    page,
  }) => {
    await createPage(page, `Smoke gallery ${Date.now()}`)

    // `gallery` is a hasMany relation (→ media) in the Details tab. Its empty
    // state renders an add button (#gallery); the picker opens in multi-select
    // mode — toggle several rows in one trip and confirm with "Add selected".
    await waitForHydration(page, '#gallery')
    await page.locator('#gallery').click()

    const rowTitle = async (rowIndex: number): Promise<string> => {
      const row = page.locator('.byline-field-relation-picker-row-button').nth(rowIndex)
      await expect(row).toBeVisible({ timeout: 30_000 })
      return (await row.innerText())
        .split('\n')
        .map((s) => s.trim())
        .find((s) => s.length > 0) as string
    }

    // Toggle two rows (aria-pressed reflects the check state), then confirm —
    // the button carries the live selection count.
    const firstTitle = await rowTitle(0)
    const secondTitle = await rowTitle(1)
    const rows = page.locator('.byline-field-relation-picker-row-button')
    await rows.nth(0).click()
    await expect(rows.nth(0)).toHaveAttribute('aria-pressed', 'true')
    await rows.nth(1).click()
    await page.getByRole('button', { name: 'Add selected (2)', exact: true }).click()

    const tiles = page.locator('.byline-field-relation-many-tile')
    await expect(tiles).toHaveCount(2)
    await expect(page.locator('.byline-field-relation.gallery')).toContainText(firstTitle)

    // Reopen the picker — both added targets must render as disabled
    // "already added" rows; dismiss without changing the selection.
    await page.locator('#gallery').click()
    await expect(page.locator('.byline-field-relation-picker-row-added')).toHaveCount(2)
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()

    // Remove the first tile; the second (secondTitle) remains.
    await tiles.first().getByRole('button', { name: 'Remove Media Item' }).click()
    await expect(page.locator('.byline-field-relation-many-tile')).toHaveCount(1)

    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Successfully updated', { exact: false }).first()).toBeVisible()

    // Reload — the single remaining gallery item must persist.
    await page.reload()
    await waitForHydration(page, '#title')
    await expect(page.locator('.byline-field-relation-many-tile')).toHaveCount(1)
    await expect(page.locator('.byline-field-relation.gallery')).toContainText(secondTitle)
  })

  test('checkbox field: toggle block constrainedWidth → save → reload round-trip', async ({
    page,
  }) => {
    await createPage(page, `Smoke checkbox ${Date.now()}`)

    // The only checkbox is `constrainedWidth` inside a Richtext Block (default
    // checked). Add the block from the Content tab; the block's `richText` is
    // required, so type a minimal body to keep the save valid, then toggle the
    // checkbox off.
    await page.getByRole('tab', { name: 'Content', exact: true }).click()
    // `.first()` — the add-row renders an icon button and a text-styled
    // label button that both accessibly-name "Add block".
    await page.getByRole('button', { name: 'Add block' }).first().click()
    await page.getByText('Richtext Block', { exact: true }).click()

    const editor = page.locator('.ContentEditable__root').first()
    await expect(editor).toBeVisible({ timeout: 30_000 })
    await editor.click()
    await page.keyboard.type(`Smoke checkbox body ${Date.now()}`)

    const checkbox = page.getByRole('checkbox', { name: 'Constrained Width' })
    await expect(checkbox).toBeChecked() // schema defaultValue: true
    await checkbox.click()
    await expect(checkbox).not.toBeChecked()

    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Successfully updated', { exact: false }).first()).toBeVisible()

    // Reload — the active tab resets to the default, so re-open Content and
    // assert the persisted block re-renders with the checkbox unchecked.
    await page.reload()
    await waitForHydration(page, '#title')
    await page.getByRole('tab', { name: 'Content', exact: true }).click()
    const reloaded = page.getByRole('checkbox', { name: 'Constrained Width' })
    await expect(reloaded).toBeVisible({ timeout: 30_000 })
    await expect(reloaded).not.toBeChecked()
  })

  test('richtext-in-blocks: add block → type → save → reload round-trip', async ({ page }) => {
    await createPage(page, `Smoke richtext ${Date.now()}`)
    const body = `Smoke richtext body ${Date.now()}`

    // The blocks `content` field lives behind the "Content" tab.
    await page.getByRole('tab', { name: 'Content', exact: true }).click()

    // Add a Richtext Block via the blocks picker modal.
    // `.first()` — the add-row renders an icon button and a text-styled
    // label button that both accessibly-name "Add block".
    await page.getByRole('button', { name: 'Add block' }).first().click()
    await page.getByText('Richtext Block', { exact: true }).click()

    // The Lexical editor mounts a contenteditable. It's code-split and
    // compiles on first visit in dev, so wait for it before typing — a
    // pre-init keystroke is dropped the same way a pre-hydration input fill is.
    const editor = page.locator('.ContentEditable__root').first()
    await expect(editor).toBeVisible({ timeout: 30_000 })
    await editor.click()
    await page.keyboard.type(body)
    await expect(editor).toContainText(body)

    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Successfully updated', { exact: false }).first()).toBeVisible()

    // Reload — the active tab resets to the default, so re-open Content and
    // assert the persisted block re-renders the typed richtext.
    await page.reload()
    await waitForHydration(page, '#title')
    await page.getByRole('tab', { name: 'Content', exact: true }).click()
    const reloadedEditor = page.locator('.ContentEditable__root').first()
    await expect(reloadedEditor).toBeVisible({ timeout: 30_000 })
    await expect(reloadedEditor).toContainText(body)
  })

  test('file upload: create media item → save → reload shows persisted image', async ({ page }) => {
    const title = `Smoke upload ${Date.now()}`
    await page.goto('/admin/collections/media/create')
    await waitForHydration(page, '#title')

    // Uploads are deferred: selecting a file stages a pending upload in the
    // form context (blob-URL preview immediately); Save executes the upload,
    // the server runs the Sharp variant pipeline, then creates the document.
    // The native input is hidden behind the drop zone — setInputFiles works on
    // hidden inputs. A 1×1 PNG buffer keeps the suite fixture-free.
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    await page.locator('.byline-field-image-upload-input').setInputFiles({
      name: 'smoke-upload.png',
      mimeType: 'image/png',
      buffer: Buffer.from(pngBase64, 'base64'),
    })

    // Staging replaces the drop zone with the preview tile (blob URL).
    await expect(page.locator('.byline-field-image-preview')).toBeVisible()

    await page.locator('#title').fill(title)
    await page.locator('#altText').fill('Editor smoke suite upload')
    await page.getByRole('button', { name: 'Save', exact: true }).click()

    // A successful create navigates to the media edit view.
    await page.waitForURL(/\/admin\/collections\/media\/(?!create)[0-9a-f-]{36}/, {
      timeout: 60_000,
    })
    await page.waitForURL((url) => !url.searchParams.has('action'))

    // Reload — the persisted document must render the stored image (thumbnail
    // variant or original storageUrl), not the staged blob preview.
    await page.reload()
    await waitForHydration(page, '#title')
    await expect(page.locator('#title')).toHaveValue(title)
    const persisted = page.locator('.byline-field-image-preview')
    await expect(persisted).toBeVisible()
    const src = await persisted.getAttribute('src')
    expect(src).not.toMatch(/^blob:/)
  })

  test('content locale: switch to Français → save translation → both locales persist', async ({
    page,
  }) => {
    const title = `Smoke locale ${Date.now()}`
    await createPage(page, title)

    // The content-locale switcher is the #contentLocale select in the view
    // menu (form header slot). Switching navigates with ?locale=fr, the
    // loader re-fetches, and the form remounts keyed on the new locale.
    await waitForHydration(page, '#contentLocale')
    await page.locator('#contentLocale').click()
    await page.getByRole('option', { name: 'Français', exact: true }).click()
    await page.waitForURL((url) => url.searchParams.get('locale') === 'fr')

    // Wait for the *remounted* fr form, not just the URL: the en form's
    // hydrated #title satisfies a bare hydration wait, and a fill landing
    // there is silently lost (or saved under en). The untranslated fr form
    // renders localized fields empty — that state only exists post-remount.
    await expect(page.locator('#title')).toHaveValue('', { timeout: 30_000 })

    // Type the French title; summary is required and also empty on the
    // untranslated form, so fill it too to keep the save valid.
    const frTitle = `${title} (français)`
    await page.locator('#title').fill(frTitle)
    await page.locator('#summary').fill('Créé par la suite de tests smoke.')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Successfully updated', { exact: false }).first()).toBeVisible()

    // Reload on fr — the translation must persist.
    await page.reload()
    await waitForHydration(page, '#title')
    await expect(page.locator('#title')).toHaveValue(frTitle)

    // Switch back to English — the original title must be untouched.
    await page.locator('#contentLocale').click()
    await page.getByRole('option', { name: 'English', exact: true }).click()
    await page.waitForURL((url) => url.searchParams.get('locale') === 'en')
    await waitForHydration(page, '#title')
    await expect(page.locator('#title')).toHaveValue(title)
  })

  test('duplicate: actions menu → confirm → lands on the copy', async ({ page }) => {
    const title = `Smoke duplicate ${Date.now()}`
    await createPage(page, title)
    const sourceUrl = page.url()

    // The document-actions dropdown trigger is the ellipsis icon button in
    // the form status bar (no accessible name — locate via the icon class).
    await page.locator('button:has(.byline-form-actions-icon)').click()
    await page.getByRole('menuitem', { name: 'Duplicate' }).click()

    // Confirm modal — the primary action repeats the "Duplicate" label; the
    // menu portal has closed by now so the match is unambiguous.
    await expect(page.getByText('Duplicate Document', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Duplicate', exact: true }).click()

    // Success navigates to the copy's edit view: a different document id
    // carrying the " (copy)"-suffixed title.
    await page.waitForURL((url) => editViewUrl.test(url.href) && url.href !== sourceUrl)
    await waitForHydration(page, '#title')
    await expect(page.locator('#title')).toHaveValue(`${title} (copy)`)
  })

  test('restore version: history → restore older version → title reverts', async ({ page }) => {
    const originalTitle = `Smoke restore ${Date.now()}`
    await createPage(page, originalTitle)
    const documentUrl = page.url().replace(/\?.*$/, '')

    // Mint a second version so history has a non-current row to restore.
    await page.locator('#title').fill(`${originalTitle} (edited)`)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Successfully updated', { exact: false }).first()).toBeVisible()

    // The versions tab of the history view renders a Restore button on every
    // non-current version — with exactly two versions there is exactly one.
    // The table arrives server-rendered, so wait for React to attach the
    // button's click handler before clicking (a pre-hydration click lands on
    // inert markup and the modal never opens).
    await page.goto(`${documentUrl}/history`)
    const restore = page.getByRole('button', { name: 'Restore', exact: true })
    await expect(restore).toBeVisible({ timeout: 30_000 })
    await waitForHydration(page, '.byline-coll-history-restore-cell button')
    await restore.click()

    // Confirm modal — restoring creates a new draft version with the old
    // content and navigates back to the edit view.
    await page.getByRole('button', { name: 'Restore as Draft', exact: true }).click()
    await page.waitForURL(editViewUrl)
    await waitForHydration(page, '#title')
    await expect(page.locator('#title')).toHaveValue(originalTitle)
  })
})
