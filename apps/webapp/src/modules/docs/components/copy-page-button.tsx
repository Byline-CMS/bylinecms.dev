'use client'

/**
 * This Source Code is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (c) Infonomic Company Limited
 */

/**
 * "Copy page" — hands the reader the document's markdown representation, for
 * pasting into an agent or an editor.
 *
 * Both halves resolve to the same `.md` URL the document already advertises
 * (see docs/05-reading-and-delivery/04-markdown-export.md): the main half
 * fetches it and writes it to the clipboard, the dropdown half additionally
 * offers to open it. Nothing is serialized client-side — the route is the one
 * source of that markdown, so what gets copied is exactly what an agent
 * fetching the URL would receive.
 */

import type React from 'react'
import { useEffect, useState } from 'react'

import { CheckIcon, ComboButton, CopyIcon, MarkdownIcon } from '@byline/ui/react'
import cx from 'classnames'

import styles from './copy-page-button.module.css'

/** How long the "Copied" confirmation stays up. */
const FEEDBACK_MS = 1600

type CopyState = 'idle' | 'busy' | 'copied' | 'failed'

interface CopyPageButtonProps {
  /** Absolute path to the document's markdown, e.g. `/docs/getting-started/cli.md`. */
  markdownPath: string
  labels: {
    copyPage: string
    copied: string
    failed: string
    viewAsMarkdown: string
  }
}

/**
 * Write text to the clipboard, falling back to a hidden textarea when the
 * async Clipboard API is unavailable. That API needs a secure context, so the
 * fallback is what keeps this working over plain HTTP — a LAN address during
 * device testing, most commonly. Mirrors the approach in `CopyButton`.
 */
async function writeToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard != null) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through — a rejected permission still has the textarea path.
    }
  }

  try {
    const element = document.createElement('textarea')
    element.value = text
    element.setAttribute('readonly', '')
    element.style.position = 'fixed'
    element.style.opacity = '0'
    document.body.appendChild(element)
    element.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(element)
    return ok
  } catch {
    return false
  }
}

export function CopyPageButton({ markdownPath, labels }: CopyPageButtonProps): React.JSX.Element {
  const [state, setState] = useState<CopyState>('idle')

  useEffect(() => {
    if (state !== 'copied' && state !== 'failed') return
    const timer = setTimeout(() => setState('idle'), FEEDBACK_MS)
    return () => clearTimeout(timer)
  }, [state])

  const copyPage = async (): Promise<void> => {
    setState('busy')
    try {
      const response = await fetch(markdownPath, {
        headers: { Accept: 'text/markdown' },
      })
      if (!response.ok) {
        setState('failed')
        return
      }
      const markdown = await response.text()
      setState((await writeToClipboard(markdown)) ? 'copied' : 'failed')
    } catch {
      setState('failed')
    }
  }

  const label =
    state === 'copied' ? labels.copied : state === 'failed' ? labels.failed : labels.copyPage

  return (
    <ComboButton
      className="byline-docs-copy-page"
      buttonClassName={cx('byline-docs-copy-page-button', styles.button)}
      variant="outlined"
      intent="noeffect"
      size="sm"
      type="button"
      // Open the menu rightward from the button's left edge, into the article
      // column. The button sits at the left of the utility row, so an
      // end-aligned menu would open leftward over the docs drawer — which
      // stacks above the dropdown — and be clipped behind it.
      align="start"
      dataSide="bottom"
      disabled={state === 'busy'}
      options={[
        {
          label: labels.copyPage,
          value: 'copy',
          icon: <CopyIcon width="16px" height="16px" />,
        },
        {
          label: labels.viewAsMarkdown,
          value: 'view',
          icon: <MarkdownIcon width="16px" height="16px" />,
        },
      ]}
      onButtonClick={() => {
        void copyPage()
      }}
      onOptionSelect={(value) => {
        if (value === 'copy') {
          void copyPage()
          return
        }
        // A plain document navigation — the `.md` route is a server handler
        // returning text/markdown, not a router route.
        window.location.href = markdownPath
      }}
    >
      <span className={cx('byline-docs-copy-page-icon', styles.icon)} aria-hidden="true">
        {state === 'copied' ? (
          <CheckIcon width="16px" height="16px" />
        ) : (
          <CopyIcon width="16px" height="16px" />
        )}
      </span>
      {label}
    </ComboButton>
  )
}
