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

import { useCallback, useEffect, useRef, useState } from 'react'
import { createFileRoute, notFound } from '@tanstack/react-router'

import { FormProvider } from '@byline/admin/react'
import { getAdminConfig } from '@byline/core'
import {
  buildManifest,
  capabilitiesFromEditor,
  type FieldCapabilities,
} from '@byline/richtext-lexical'
import { Button } from '@byline/ui/react'

import {
  collectRichTextTargets,
  type RichTextTarget,
} from '../../../lib/richtext-capability-targets'

export const Route = createFileRoute('/_byline/admin/richtext-capabilities')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) {
      throw notFound()
    }
  },
  component: RichTextCapabilitiesGenerator,
})

/** Mounts one field's editor off-screen and reports what it registered. */
function Probe({
  target,
  onMeasured,
}: {
  target: RichTextTarget
  onMeasured: (capabilities: FieldCapabilities) => void
}): React.JSX.Element | null {
  const hostRef = useRef<HTMLDivElement>(null)
  const reported = useRef(false)

  useEffect(() => {
    if (target.Editor == null) {
      if (!reported.current) {
        reported.current = true
        onMeasured({
          collectionPath: target.collectionPath,
          fieldPath: target.fieldPath,
          supportedTypes: null,
          unresolvedReason: target.unresolvedReason,
        })
      }
      return
    }

    // The editor is lazy, so poll for the contenteditable Lexical
    // attaches its instance to rather than guessing at a delay.
    let cancelled = false
    let attempts = 0
    const tick = () => {
      if (cancelled || reported.current) return
      const editable = hostRef.current?.querySelector('[contenteditable="true"]')
      // biome-ignore lint/suspicious/noExplicitAny: Lexical attaches its editor here
      const editor = (editable as any)?.__lexicalEditor
      if (editor != null) {
        reported.current = true
        onMeasured(capabilitiesFromEditor(target.collectionPath, target.fieldPath, editor))
        return
      }
      if (attempts++ > 100) {
        reported.current = true
        onMeasured({
          collectionPath: target.collectionPath,
          fieldPath: target.fieldPath,
          supportedTypes: null,
          unresolvedReason: 'Editor did not mount within the measurement window.',
        })
        return
      }
      setTimeout(tick, 50)
    }
    tick()
    return () => {
      cancelled = true
    }
  }, [target, onMeasured])

  if (target.Editor == null) return null
  const { Editor } = target
  // Only FormProvider is added here. Everything else an editor needs —
  // field services, admin services, the AI config, i18n — is already
  // above this route: the admin layout wraps its Outlet in them
  // (`create-admin-layout-route.tsx`). Measuring inside that tree is the
  // point, since it is the tree a real field renders in; supplying stubs
  // instead would measure a different arrangement from the one that
  // ships. FormProvider is the exception because it is per-document
  // rather than per-shell, and nothing is submitted through it.
  return (
    <div ref={hostRef} aria-hidden="true" style={{ height: 0, overflow: 'hidden' }}>
      <FormProvider collectionPath={target.collectionPath}>
        <Editor
          field={target.field}
          defaultValue={undefined}
          onChange={() => {}}
          path={target.fieldPath}
          instanceKey={`${target.collectionPath}:${target.fieldPath}`}
        />
      </FormProvider>
    </div>
  )
}

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
        <Probe
          key={`${target.collectionPath}:${target.fieldPath}`}
          target={target}
          onMeasured={onMeasured}
        />
      ))}
    </main>
  )
}
