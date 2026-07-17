/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Structural editing of an `array` field nested inside a block — the fix for
 * ISSUE-array-fields-in-blocks: a freshly added FAQ block must render its
 * `faq` array title and add-row, items must be addable / removable /
 * drag-reorderable, and everything must round-trip through save + reload.
 *
 * Self-contained per the smoke-suite convention: creates its own throwaway
 * `pages` document (never touches the seeded FAQ fixture, which the
 * block-admin-override spec depends on for item order).
 */

import { expect, test } from '@playwright/test'

const editViewUrl = /\/admin\/collections\/pages\/(?!create)[0-9a-f-]{36}/

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
  await page.locator('#summary').fill('Created by the array-in-block suite.')
  const save = page.getByRole('button', { name: 'Save', exact: true })
  await expect(save).toBeEnabled()
  await save.click()
  await page.waitForURL(editViewUrl)
  await page.waitForURL((url) => !url.searchParams.has('action'))
  await waitForHydration(page, '#title')
}

async function openContentTab(page: import('@playwright/test').Page) {
  await page.getByRole('tab', { name: 'Content', exact: true }).click()
}

async function save(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Successfully updated', { exact: false }).first()).toBeVisible()
}

test.describe('array field inside a block (FAQ)', () => {
  test('add block → add items → fill → save → reorder → remove → round-trips', async ({ page }) => {
    await createPage(page, `Smoke faq array ${Date.now()}`)
    await openContentTab(page)

    // Add an FAQ block from the picker modal.
    await page.getByRole('button', { name: 'Add block' }).first().click()
    await page.getByText('FAQ', { exact: true }).click()

    // The freshly added block must render the array's title and add-row —
    // the original defect left a new FAQ block completely blank.
    const faqArray = page.locator('.byline-field-array.faq')
    await expect(faqArray.getByRole('heading', { name: 'Questions' })).toBeVisible()
    const addItem = faqArray.getByRole('button', { name: 'Add item' }).first()
    await expect(addItem).toBeVisible()

    // Add two items; each renders a positioned header label.
    await addItem.click()
    await expect(faqArray.locator('.byline-sortable-label')).toHaveText(['Questions 1'])
    await addItem.click()
    await expect(faqArray.locator('.byline-sortable-label')).toHaveText([
      'Questions 1',
      'Questions 2',
    ])

    // Fill both question inputs and the first answer (Lexical is code-split —
    // allow the first-compile window before typing).
    const questions = faqArray.locator('input[type="text"]')
    await questions.nth(0).fill('First question?')
    await questions.nth(1).fill('Second question?')

    const answers = faqArray.locator('.ContentEditable__root')
    await expect(answers.first()).toBeVisible({ timeout: 30_000 })
    await answers.first().click()
    await page.keyboard.type('First answer.')
    await expect(answers.first()).toContainText('First answer.')

    await save(page)

    // Reload — items, values, and the array chrome must all come back.
    await page.reload()
    await waitForHydration(page, '#title')
    await openContentTab(page)
    await expect(faqArray.getByRole('heading', { name: 'Questions' })).toBeVisible()
    await expect(faqArray.locator('input[type="text"]')).toHaveCount(2, { timeout: 30_000 })
    await expect(faqArray.locator('input[type="text"]').nth(0)).toHaveValue('First question?')
    await expect(faqArray.locator('input[type="text"]').nth(1)).toHaveValue('Second question?')
    await expect(faqArray.locator('.ContentEditable__root').first()).toContainText('First answer.')

    // Drag-reorder via the KeyboardSensor (deterministic, unlike synthetic
    // pointer moves): focus the second item's grip, Space to pick up,
    // ArrowUp to move above the first item, Space to drop.
    const grips = faqArray.locator('.byline-sortable-grip')
    await expect(grips).toHaveCount(2)
    // Post-reload the inputs arrive server-rendered, so value assertions can
    // pass before React attaches the grip's keyboard listeners — wait for
    // hydration first. The keyboard drag itself can silently no-op while
    // late-mounting editors are still shifting layout (dnd-kit measures
    // droppable rects at pickup), so attempt → verify → settle → retry.
    await waitForHydration(page, '.byline-field-array.faq .byline-sortable-grip')
    const firstQuestion = faqArray.locator('input[type="text"]').nth(0)
    // dnd-kit's aria-live announcements are the synchronization primitive:
    // each step is awaited before the next key, so the drop can't fire while
    // the coordinate move is still pending.
    const announcer = page.locator('[aria-live]').first()
    await expect(async () => {
      // Cancel any drag a failed attempt left in flight, then pick up.
      await page.keyboard.press('Escape')
      const grip = grips.nth(1)
      await grip.focus()
      await page.keyboard.press('Space')
      await expect(grip).toHaveAttribute('aria-pressed', 'true', { timeout: 2_000 })
      // Pickup announces "…was moved over droppable area <activeId>."
      const activeId = (await announcer.innerText()).match(/Draggable item ([0-9a-f-]+)/)?.[1]
      if (!activeId) throw new Error('no drag announcement after pickup')
      await page.keyboard.press('ArrowUp')
      // Wait until the drag is over the *other* item before dropping.
      await expect(announcer).not.toContainText(`droppable area ${activeId}`, { timeout: 2_000 })
      await page.keyboard.press('Space')
      await expect(firstQuestion).toHaveValue('Second question?', { timeout: 2_000 })
    }).toPass({ intervals: [500, 1_000, 2_000], timeout: 30_000 })

    await save(page)
    await page.reload()
    await waitForHydration(page, '#title')
    await openContentTab(page)
    await expect(faqArray.locator('input[type="text"]').nth(0)).toHaveValue('Second question?', {
      timeout: 30_000,
    })
    await expect(faqArray.locator('input[type="text"]').nth(1)).toHaveValue('First question?')

    // Remove the first item ("Second question?") via its context menu.
    await faqArray.getByRole('button', { name: 'Item actions' }).first().click()
    await page.getByRole('menuitem', { name: 'Remove' }).click()
    await expect(faqArray.locator('input[type="text"]')).toHaveCount(1)
    await expect(faqArray.locator('input[type="text"]').first()).toHaveValue('First question?')

    await save(page)
    await page.reload()
    await waitForHydration(page, '#title')
    await openContentTab(page)
    await expect(faqArray.locator('input[type="text"]')).toHaveCount(1, { timeout: 30_000 })
    await expect(faqArray.locator('input[type="text"]').first()).toHaveValue('First question?')
  })
})
