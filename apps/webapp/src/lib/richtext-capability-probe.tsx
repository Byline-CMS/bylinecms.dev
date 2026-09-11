/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * Measuring one richtext field's capabilities by mounting its editor.
 *
 * Shared by the development route at `/admin/richtext-capabilities` and
 * the CI harness, so the two cannot measure differently. What they do
 * NOT share is the surrounding provider tree, and that difference is
 * deliberate: in the app the admin layout already supplies field
 * services, admin services, the AI config and i18n, so the route
 * measures inside the real tree; the harness has no layout and supplies
 * them itself.
 */

import { useEffect, useRef } from 'react'

import { FormProvider } from '@byline/admin/react'
import { capabilitiesFromEditor, type FieldCapabilities } from '@byline/richtext-lexical'

import type { RichTextTarget } from './richtext-capability-targets'

/** Attempts before a field is declared unmeasurable, at 50ms apart. */
const MAX_ATTEMPTS = 100

/**
 * Mounts one field's editor off-screen and reports what it registered.
 *
 * Lexical attaches its editor to the contenteditable element, so the
 * measurement polls for that rather than guessing at a delay: the editor
 * is lazy, and a fixed wait races its dynamic import.
 *
 * `FormProvider` is added here because it is per-document rather than
 * per-shell — the editor reads form state through context and a bare
 * mount throws. Nothing is submitted through it.
 */
export function CapabilityProbe({
  target,
  onMeasured,
}: {
  target: RichTextTarget
  onMeasured: (capabilities: FieldCapabilities) => void
}): React.JSX.Element | null {
  const hostRef = useRef<HTMLDivElement>(null)
  const reported = useRef(false)

  useEffect(() => {
    const report = (capabilities: FieldCapabilities) => {
      if (reported.current) return
      reported.current = true
      onMeasured(capabilities)
    }

    if (target.Editor == null) {
      report({
        collectionPath: target.collectionPath,
        fieldPath: target.fieldPath,
        supportedTypes: null,
        unresolvedReason: target.unresolvedReason,
      })
      return
    }

    let cancelled = false
    let attempts = 0
    const tick = () => {
      if (cancelled || reported.current) return
      const editable = hostRef.current?.querySelector('[contenteditable="true"]')
      // biome-ignore lint/suspicious/noExplicitAny: Lexical attaches its editor here
      const editor = (editable as any)?.__lexicalEditor
      if (editor != null) {
        report(capabilitiesFromEditor(target.collectionPath, target.fieldPath, editor))
        return
      }
      if (attempts++ > MAX_ATTEMPTS) {
        report({
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
