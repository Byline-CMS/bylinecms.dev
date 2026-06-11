/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Auth setup project: signs in through the real sign-in form once and
 * persists the session to `e2e/.auth/admin.json`, which every other
 * project reuses as `storageState`. Going through the form (rather than
 * seeding a cookie) keeps the sign-in flow itself under test on every run
 * — this is the surface the v3.5.1 form-GET leak lived on.
 */

import { expect, test as setup } from '@playwright/test'

const adminAuthFile = 'e2e/.auth/admin.json'

setup('sign in as super-admin', async ({ page }) => {
  const email = process.env.BYLINE_SUPERADMIN_EMAIL
  const password = process.env.BYLINE_SUPERADMIN_PASSWORD
  if (!email || !password) {
    throw new Error(
      'BYLINE_SUPERADMIN_EMAIL and BYLINE_SUPERADMIN_PASSWORD must be set ' +
        '(loaded from apps/webapp/.env.local — see .env.local.example).'
    )
  }

  await page.goto('/sign-in')

  // A submit before React hydrates falls back to the native form post and
  // reloads the sign-in page with empty fields — the same pre-hydration
  // submit mechanism behind the v3.5.1 form-GET leak (root cause still
  // open). The dev server's first compile makes that window seconds wide
  // and `networkidle` never fires under Vite dev (HMR sockets), so retry
  // the whole fill-and-submit until the client-side handler owns it.
  let signedIn = false
  for (let attempt = 0; attempt < 3 && !signedIn; attempt++) {
    await page.locator('#email').fill(email)
    await page.locator('#password').fill(password)
    await page.getByRole('button', { name: 'Sign In' }).click()
    signedIn = await page
      .waitForURL('**/admin**', { timeout: 15_000 })
      .then(() => true)
      .catch(() => false)
    if (!signedIn && (await page.getByText('Invalid credentials.').isVisible())) {
      throw new Error(
        'Sign-in rejected: the BYLINE_SUPERADMIN_* credentials in .env.local ' +
          'do not match the seeded super-admin (re-run `pnpm tsx byline/seed.ts`).'
      )
    }
  }
  expect(signedIn, 'sign-in should navigate into /admin').toBe(true)

  // Regression guard for the v3.5.1 form-GET credential leak: the
  // credentials must never appear in the URL query string.
  expect(page.url()).not.toContain(encodeURIComponent(email))
  expect(page.url()).not.toContain('password')

  await page.context().storageState({ path: adminAuthFile })
})
