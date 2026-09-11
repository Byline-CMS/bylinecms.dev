/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Every configured richtext field can be measured — and, on request,
 * writes the capability manifest the pre-upgrade scan consumes.
 *
 * As a test this guards a specific failure: a field whose editor cannot
 * mount is reported with unknown capabilities, which makes
 * `richtext-scan.ts` refuse to call its documents clean. That is the
 * safe outcome, but it is not a good one, and it should be caught here
 * rather than discovered during an upgrade.
 *
 * As a generator it removes the manual browser step:
 *
 *   BYLINE_WRITE_MANIFEST=1 pnpm vitest run --mode=jsdom \
 *     src/__tests__/richtext-capability-manifest.test.tsx
 *
 * It shares `collectRichTextTargets` and `CapabilityProbe` with the
 * development route, so resolution and measurement cannot drift apart.
 * It does NOT share the provider tree: in the app those come from the
 * admin layout, and here they are reconstructed. So this covers the
 * shared logic, not browser/provider parity — an editor depending on
 * something the layout provides and this omits would measure
 * differently, or fail here alone.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { act } from 'react'

import { BylineFieldServicesProvider } from '@byline/admin/react'
import { getAdminConfig } from '@byline/core'
import { BylineAiAdminProvider } from '@byline/host-tanstack-start/integrations/byline-ai'
import { buildManifest, type FieldCapabilities } from '@byline/richtext-lexical'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'

import { CapabilityProbe } from '../lib/richtext-capability-probe'
import { collectRichTextTargets } from '../lib/richtext-capability-targets'

// Registers the app's admin config, which is what declares the fields
// and their editors.
import '../../byline/admin.config'

// biome-ignore lint/suspicious/noExplicitAny: React act environment flag
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const MANIFEST_PATH = resolve('byline/generated/richtext-capabilities.json')

/**
 * Field services the probe never calls — measuring registers node
 * classes and nothing else. In the app these come from the admin layout;
 * the harness has no layout.
 */
// biome-ignore lint/suspicious/noExplicitAny: a deliberately inert stub
const services: any = {
  getCollectionDocuments: async () => ({ docs: [], total: 0 }),
  uploadField: async () => ({}),
}

async function measureAll(): Promise<FieldCapabilities[]> {
  const targets = collectRichTextTargets(getAdminConfig())
  const measured: FieldCapabilities[] = []

  for (const target of targets) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)

    let capabilities: FieldCapabilities | undefined
    await act(async () => {
      root.render(
        <BylineFieldServicesProvider services={services}>
          <BylineAiAdminProvider>
            <CapabilityProbe
              target={target}
              onMeasured={(result) => {
                capabilities = result
              }}
            />
          </BylineAiAdminProvider>
        </BylineFieldServicesProvider>
      )
    })

    // The probe polls for the editor, so let its attempts run.
    for (let attempt = 0; attempt < 60 && capabilities == null; attempt++) {
      await act(async () => {
        await new Promise((settle) => setTimeout(settle, 20))
      })
    }

    measured.push(
      capabilities ?? {
        collectionPath: target.collectionPath,
        fieldPath: target.fieldPath,
        supportedTypes: null,
        unresolvedReason: 'Probe never reported.',
      }
    )

    await act(async () => {
      root.unmount()
    })
    container.remove()
  }

  return measured
}

describe('richtext capability manifest', () => {
  it('measures every configured richtext field', async () => {
    const measured = await measureAll()
    expect(measured.length).toBeGreaterThan(0)

    const unmeasured = measured
      .filter((field) => field.supportedTypes == null)
      .map((field) => `${field.collectionPath}.${field.fieldPath} — ${field.unresolvedReason}`)

    // An unmeasurable field is safe — the scan refuses to call its
    // documents clean — but it is not acceptable: it leaves an operator
    // unable to check that field before an upgrade.
    expect(unmeasured).toEqual([])

    if (process.env.BYLINE_WRITE_MANIFEST === '1') {
      mkdirSync(dirname(MANIFEST_PATH), { recursive: true })
      writeFileSync(MANIFEST_PATH, `${JSON.stringify(buildManifest(measured), null, 2)}\n`)
      console.log(`Wrote ${measured.length} field(s) to ${MANIFEST_PATH}`)
    }
  }, 180_000)

  it('narrows block fields below the global editor', async () => {
    // The manifest's whole value depends on per-field resolution. If a
    // block field ever reported the same capabilities as the global
    // editor, the scan built on it would call affected documents clean.
    const measured = await measureAll()
    const widest = Math.max(...measured.map((field) => field.supportedTypes?.length ?? 0))
    const captions = measured.filter((field) => field.fieldPath.endsWith('.caption'))

    expect(captions.length).toBeGreaterThan(0)
    for (const caption of captions) {
      expect(caption.supportedTypes?.length ?? 0).toBeLessThan(widest)
    }
  }, 180_000)
})
