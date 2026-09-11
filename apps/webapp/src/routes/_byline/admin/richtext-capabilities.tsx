/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Development-only generator for the richtext capability manifest.
 *
 * A field's capabilities are measured by BUILDING its editor, which
 * needs a DOM and a React-capable module graph — plain Node cannot even
 * transform the extension modules. So the manifest is produced here,
 * where the client configuration already loads, and handed to
 * `byline/scripts/richtext-scan.ts`, which has the database but not the
 * editor.
 *
 * Reads nothing and writes nothing: it walks the schema, mounts each
 * richtext editor off-screen, records which node types it registered,
 * and offers the result as JSON.
 *
 * Visit `/admin/richtext-capabilities` with the development server
 * running, then save the file to `byline/generated/`.
 */

import { useCallback, useState } from 'react'
import { createFileRoute, notFound } from '@tanstack/react-router'

import { getAdminConfig } from '@byline/core'
import { buildManifest, type FieldCapabilities } from '@byline/richtext-lexical'
import { Button } from '@byline/ui/react'

import { CapabilityProbe } from '../../../lib/richtext-capability-probe'
import { collectRichTextTargets } from '../../../lib/richtext-capability-targets'

export const Route = createFileRoute('/_byline/admin/richtext-capabilities')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) {
      throw notFound()
    }
  },
  component: RichTextCapabilitiesGenerator,
})

function RichTextCapabilitiesGenerator(): React.JSX.Element {
  const [targets] = useState(() => collectRichTextTargets(getAdminConfig()))
  const [measured, setMeasured] = useState<FieldCapabilities[]>([])

  const onMeasured = useCallback((capabilities: FieldCapabilities) => {
    setMeasured((current) =>
      current.some(
        (entry) =>
          entry.collectionPath === capabilities.collectionPath &&
          entry.fieldPath === capabilities.fieldPath
      )
        ? current
        : [...current, capabilities]
    )
  }, [])

  const done = measured.length === targets.length
  const manifest = done ? buildManifest(measured) : null
  const json = manifest != null ? `${JSON.stringify(manifest, null, 2)}\n` : ''

  return (
    <main style={{ margin: '0 auto', maxWidth: 860, padding: 24 }}>
      <h1 style={{ fontSize: 20 }}>Richtext capability manifest</h1>
      <p style={{ color: '#555', fontSize: 13 }}>
        Development only. Measures what each richtext field accepts by building its editor, then
        hands the result to <code>byline/scripts/richtext-scan.ts</code>. Reads and writes no
        content.
      </p>

      <p style={{ fontSize: 13 }}>
        Measured {measured.length} of {targets.length} field{targets.length === 1 ? '' : 's'}.
      </p>

      {done && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <Button
              type="button"
              variant="outlined"
              size="sm"
              onClick={() => {
                const blob = new Blob([json], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const anchor = document.createElement('a')
                anchor.href = url
                anchor.download = 'richtext-capabilities.json'
                anchor.click()
                URL.revokeObjectURL(url)
              }}
            >
              Download manifest
            </Button>
            <Button
              type="button"
              variant="outlined"
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(json)
              }}
            >
              Copy to clipboard
            </Button>
          </div>
          <p style={{ fontSize: 13 }}>
            Save as <code>apps/webapp/byline/generated/richtext-capabilities.json</code>, then run{' '}
            <code>pnpm tsx byline/scripts/richtext-scan.ts</code>.
          </p>
          <pre
            style={{
              background: '#f6f6f6',
              borderRadius: 4,
              fontSize: 12,
              maxHeight: 420,
              overflow: 'auto',
              padding: 12,
            }}
          >
            {json}
          </pre>
        </>
      )}

      {targets.map((target) => (
        <CapabilityProbe
          key={`${target.collectionPath}:${target.fieldPath}`}
          target={target}
          onMeasured={onMeasured}
        />
      ))}
    </main>
  )
}
