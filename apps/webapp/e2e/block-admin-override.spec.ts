/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Dotted schema-path block admin override — browser-level proof that a
 * `defineBlockAdmin` entry keyed `faq.answer` reaches the richText field
 * nested inside the FAQ block's `faq` array (FAQBlockAdmin in
 * byline/blocks/faq-block.admin.ts).
 *
 * The site-wide richText registration is the AI-enabled editor, whose
 * toolbar carries the "Toggle AI assistant" button; the FAQ override editor
 * does not. The button is therefore the observable marker: absent inside
 * the faq array, present in a freshly added Richtext Block on the same page.
 *
 * Depends on the seeded FAQ fixture document
 * (`byline/seeds/faq-fixture.ts`, part of `pnpm tsx byline/seed.ts`) —
 * a stable item order this spec can assert against without creating its
 * own items (structural editing flows live in array-in-block.spec.ts).
 */

import { expect, test } from '@playwright/test'

/**
 * Wait until React has attached handlers to the element — same rationale as
 * the editor smoke suite: interactions that land before hydration hit inert
 * markup (a pre-hydration tab click focuses but never selects).
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

test.describe('block admin override (dotted schema path)', () => {
  test('faq.answer renders the override editor; site-wide editor keeps AI', async ({ page }) => {
    // Open the seeded fixture from the pages list.
    await page.goto(`/admin/collections/pages?query=${encodeURIComponent('FAQ fixture')}`)
    await expect(page.getByRole('table')).toBeVisible()
    await page.getByRole('row').filter({ hasText: 'FAQ fixture' }).getByRole('link').first().click()
    await page.waitForURL(/\/admin\/collections\/pages\/(?!create)[0-9a-f-]{36}/)
    await waitForHydration(page, '#title')

    // The blocks `content` field lives behind the Content tab.
    await page.getByRole('tab', { name: 'Content', exact: true }).click()

    // The FAQ array renders both seeded items: two question inputs and two
    // answer editors (Lexical is code-split — allow the first-compile window).
    const faqArray = page.locator('.byline-field-array.faq')
    const answerEditors = faqArray.locator('.ContentEditable__root')
    await expect(answerEditors).toHaveCount(2, { timeout: 30_000 })
    await expect(answerEditors.first()).toContainText('AI-first')
    await expect(faqArray.locator('input[type="text"]').first()).toHaveValue('What is Byline?')

    // Override applied: no AI toolbar button anywhere inside the faq array.
    await expect(faqArray.getByRole('button', { name: 'Toggle AI assistant' })).toHaveCount(0)

    // Positive control — the marker exists on this page when the site-wide
    // editor renders: add a Richtext Block (unsaved, discarded with the
    // page) and its toolbar must carry the AI button.
    await page.getByRole('button', { name: 'Add block' }).first().click()
    await page.getByText('Richtext Block', { exact: true }).click()
    await expect(page.getByRole('button', { name: 'Toggle AI assistant' }).first()).toBeVisible({
      timeout: 30_000,
    })
  })
})
